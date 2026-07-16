// "الفرص" (Opportunities) — the scout.
//
// ONE OpenAI Responses call per scan, with the built-in `web_search` tool and a
// strict json_schema response. That single call is the entire internet budget:
// the model runs its own searches, reads what it needs, and hands back clean
// rows. No scraping, no crawler, no third-party search key, nothing to maintain.
//
// Cost control (the owner's explicit ask — "خفيفة والسحب قليل"):
//   • one scan per day (plus the occasional manual click)
//   • MAX_RESULTS caps what comes back
//   • search_context_size: 'medium' — enough to read an article, not a library
//   • beginRun() in the store refuses to stack a second scan on a running one
//
// Everything the model returns is treated as untrusted: validated, clamped and
// trimmed in sanitize() before it can reach S3.

import OpenAI from 'openai'
import { getAiConfig, getOpenAiKey } from '@/lib/ai/config'
import {
  CATEGORY_KEYS,
  STAGE_KEYS,
  isValidCategory,
  type OpportunityCategory,
  type OpportunityContact,
  type OpportunityStage,
  type ScanTrigger,
} from './types'
import { beginRun, finishRun, mergeFindings, type NewOpportunity } from './store'

// How many finds we accept from one scan. Ten good leads a day is already more
// than a sales team works through; more would just burn tokens.
const MAX_RESULTS = 10

// How far back the news sweep looks. Wider than the daily cadence on purpose —
// dedup in the store kills the overlap, and it means a missed day self-heals.
const LOOKBACK_DAYS = 14

// 'low' | 'medium' | 'high' — how much of the page text the tool pulls in.
const SEARCH_CONTEXT: 'low' | 'medium' | 'high' = 'medium'

// Field caps. The model is told to be brief; this is the hard stop.
const MAX_LEN = { title: 160, summary: 600, relevance: 400, targeting: 700, city: 80, owner: 160, contact: 200 }
const MAX_CONTACTS = 4
const MAX_URLS = 4

// gpt-5.x / o-series reject `temperature` and take `reasoning.effort` instead —
// same branch the shared OpenAI provider makes (src/lib/ai/providers/openai.ts).
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model)
}

// ─── the contract we force on the model ─────────────────────────────────────
// OpenAI strict mode demands additionalProperties:false and every property
// listed in `required` — optionality is expressed with a nullable type.
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['opportunities'],
  properties: {
    opportunities: {
      type: 'array',
      description: `Up to ${MAX_RESULTS} verified opportunities. Fewer is better than invented.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'summary', 'category', 'stage', 'city', 'owner',
          'contacts', 'relevance', 'targeting', 'score', 'sourceUrls', 'publishedAt',
        ],
        properties: {
          title: { type: 'string', description: 'Project name as published. Arabic or English, as found.' },
          summary: { type: 'string', description: '1-3 sentences: what the project is, size/value if published.' },
          category: { type: 'string', enum: CATEGORY_KEYS },
          stage: { type: 'string', enum: STAGE_KEYS },
          city: { type: 'string', description: 'City/region in Saudi Arabia. Empty string if not stated.' },
          owner: { type: 'string', description: 'Developer / main contractor / government entity behind it.' },
          contacts: {
            type: 'array',
            description: 'PUBLIC business contact points only. Empty array if none published.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'role', 'email', 'phone', 'website', 'source'],
              properties: {
                name: { type: 'string', description: 'Department/desk or company name. Empty string if unknown.' },
                role: { type: 'string', description: 'e.g. Procurement, Tenders, Main office. Empty if unknown.' },
                email: { type: 'string', description: 'Published business email, else empty string.' },
                phone: { type: 'string', description: 'Published business phone, else empty string.' },
                website: { type: 'string', description: 'Official site/tender page, else empty string.' },
                source: { type: 'string', description: 'URL where this contact was published.' },
              },
            },
          },
          relevance: { type: 'string', description: 'The concrete marble/granite scope we could win here.' },
          targeting: { type: 'string', description: 'Concrete next steps to approach them, in Arabic.' },
          score: { type: 'number', description: '0-100 priority for a marble supplier. Be honest, not generous.' },
          sourceUrls: { type: 'array', items: { type: 'string' }, description: 'Working links backing this row.' },
          publishedAt: { type: ['string', 'null'], description: 'ISO date (YYYY-MM-DD) of the news, or null.' },
        },
      },
    },
  },
} as const

interface RawOpportunity {
  title?: unknown
  summary?: unknown
  category?: unknown
  stage?: unknown
  city?: unknown
  owner?: unknown
  contacts?: unknown
  relevance?: unknown
  targeting?: unknown
  score?: unknown
  sourceUrls?: unknown
  publishedAt?: unknown
}

// ─── prompt ─────────────────────────────────────────────────────────────────

function buildInstruction(): string {
  return `أنت محلل تطوير أعمال لشركة "كاسب" السعودية، متخصصة في **توريد وتركيب الرخام والجرانيت الطبيعي**.
مهمتك: تبحث في الإنترنت عن **مشاريع جديدة في السعودية فقط** نقدر نوردّ لها رخام أو جرانيت، وترجّع صفوف نظيفة وموثّقة.

## القواعد الصارمة
1. **السعودية فقط.** أي مشروع خارج المملكة يُرفض تماماً — لا تُرجعه إطلاقاً.
2. **أخبار حديثة فقط** — خلال آخر ${LOOKBACK_DAYS} يوم. لا تُرجع مشاريع قديمة أو مكتملة.
3. **لا تخترع أبداً.** كل معلومة لازم تكون منشورة فعلاً في مصدر تقدر تعطي رابطه. إذا ما لقيت معلومة، اترك الحقل نصاً فارغاً (أو null للتاريخ). **صفوف أقل وموثّقة أفضل بكثير من صفوف كثيرة مخترعة.**
4. **جهات التواصل: معلومات أعمال عامة فقط** — إيميل/هاتف/موقع منشور رسمياً من الجهة نفسها (موقعها الرسمي، بوابة مناقصات، بيان صحفي). على مستوى الشركة أو الإدارة (مثل "إدارة المشتريات"). **ممنوع تماماً**: بيانات شخصية خاصة، أو أرقام/إيميلات مخمّنة أو مركّبة. إذا ما فيه تواصل منشور → أرجع مصفوفة فارغة.
5. **الصلة بالرخام شرط.** المشروع لازم يكون فيه نطاق تشطيبات حجرية محتمل (أرضيات، واجهات، درج، حمامات، لوبيات). لو المشروع ما له علاقة (مثل شبكة كهرباء أو مشروع برمجي) → لا ترجعه.
6. **الأولوية للتوقيت الصح**: المشاريع في مرحلة **المناقصة أو ما بعد الترسية أو قرب التشطيب** هي الأثمن (هذا وقت شراء الرخام). أعطها درجة أعلى من مشروع لسه "معلن" فقط.
7. **درجة الأولوية (score) صادقة**: 80-100 = فرصة ضخمة وقريبة وواضحة الجهة. 50-79 = جيدة. 1-49 = ضعيفة أو معلومات ناقصة. لا تعطي كل الصفوف درجات عالية.
8. أقصى عدد: **${MAX_RESULTS}** فرص.

## التصنيف (category) — اختر واحداً بالضبط
- \`government\`: مشاريع حكومية وعملاقة (نيوم، روشن، القدية، أمانات، وزارات، مشاريع الدولة الكبرى).
- \`developers\`: مطوّرون عقاريون، أبراج سكنية/تجارية، كمباوندات، مجمّعات سكنية.
- \`commercial\`: مولات، فنادق، مستشفيات، مطارات، مكاتب، منشآت تجارية وضيافة.
- \`landmark\`: مساجد، قصور خاصة، واجهات حجرية ومعالم.

## الحقول
- \`title\`: اسم المشروع كما نُشر.
- \`summary\`: ٢-٣ جمل: إيش المشروع، وحجمه/قيمته إذا منشورة.
- \`stage\`: من القائمة المحددة فقط.
- \`city\`: المدينة/المنطقة في السعودية.
- \`owner\`: الجهة المالكة/المطوّر/المقاول الرئيسي.
- \`relevance\`: **نطاق الرخام تحديداً** اللي ممكن نكسبه هنا (مثال: "أرضيات لوبي + واجهات حجرية + درج رخام لـ ٣ أبراج").
- \`targeting\`: **خطوات عملية بالعربي** للدخول معهم (مين نكلّم، وش نجهّز، وش التوقيت الصح). كن محدداً ومفيداً، لا كلام عام.
- \`sourceUrls\`: روابط حقيقية شغّالة تثبت الصف.
- \`publishedAt\`: تاريخ الخبر بصيغة YYYY-MM-DD أو null.

اكتب \`summary\` و \`relevance\` و \`targeting\` **بالعربي**. أرجع JSON فقط مطابقاً للمخطط.`
}

function buildUserText(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `تاريخ اليوم: ${today}.
ابحث الآن في الإنترنت عن أحدث المشاريع الإنشائية والعقارية المعلنة في **السعودية** خلال آخر ${LOOKBACK_DAYS} يوم، واللي فيها فرصة توريد وتركيب رخام/جرانيت.

غطِّ مصادر متنوعة: الأخبار الاقتصادية والعقارية السعودية، إعلانات المطوّرين، بوابات المناقصات الحكومية (مثل اعتماد/منافسات)، بيانات الترسيات، وأخبار المقاولين.

لكل فرصة: وثّقها برابط، واستخرج جهات التواصل العامة المنشورة فقط، واقترح طريقة استهداف عملية. أرجع JSON فقط.`
}

// ─── sanitising the model's output ──────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function httpUrl(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : ''
  } catch {
    return ''
  }
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v.trim())
  if (Number.isNaN(d.getTime())) return null
  // Never let a hallucinated future date through.
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null
  return d.toISOString().slice(0, 10)
}

function sanitizeContacts(v: unknown): OpportunityContact[] {
  if (!Array.isArray(v)) return []
  const out: OpportunityContact[] = []
  for (const raw of v.slice(0, MAX_CONTACTS)) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const email = str(c.email, MAX_LEN.contact)
    const contact: OpportunityContact = {
      name: str(c.name, MAX_LEN.contact),
      role: str(c.role, MAX_LEN.contact),
      // Drop anything that isn't shaped like an email rather than showing the
      // team a broken mailto: link.
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      phone: str(c.phone, 40),
      website: httpUrl(c.website),
      source: httpUrl(c.source),
    }
    // A contact with no way to reach anyone is noise.
    if (!contact.email && !contact.phone && !contact.website) continue
    out.push(contact)
  }
  return out
}

function sanitize(raw: RawOpportunity): NewOpportunity | null {
  const title = str(raw.title, MAX_LEN.title)
  const owner = str(raw.owner, MAX_LEN.owner)
  if (!title) return null // a row with no project name is unusable

  const category: OpportunityCategory = isValidCategory(raw.category) ? raw.category : 'developers'
  const stage = (STAGE_KEYS as string[]).includes(raw.stage as string)
    ? (raw.stage as OpportunityStage)
    : 'unknown'

  const scoreNum = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0
  const score = Math.max(0, Math.min(100, Math.round(scoreNum)))

  const sourceUrls = Array.isArray(raw.sourceUrls)
    ? Array.from(new Set(raw.sourceUrls.map(httpUrl).filter(Boolean))).slice(0, MAX_URLS)
    : []

  return {
    title,
    summary: str(raw.summary, MAX_LEN.summary),
    category,
    stage,
    city: str(raw.city, MAX_LEN.city),
    owner,
    contacts: sanitizeContacts(raw.contacts),
    relevance: str(raw.relevance, MAX_LEN.relevance),
    targeting: str(raw.targeting, MAX_LEN.targeting),
    score,
    sourceUrls,
    publishedAt: isoDate(raw.publishedAt),
  }
}

// ─── the scan ───────────────────────────────────────────────────────────────

export interface ScanResult {
  ok: boolean
  found: number
  added: number
  error: string | null
  skipped?: boolean // a scan was already running
}

// Models we'd happily run the scout on, best first. All are Responses-API
// models that support the web_search tool.
const PREFERRED_MODELS = [
  'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5-mini', 'gpt-5.5',
  'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o',
]

// Not text/chat models — never pick these as a last resort.
const NOT_CHAT = /(image|audio|tts|realtime|whisper|embedding|moderation|dall|transcrib|sora|computer-use)/i

// What the account can ACTUALLY call. Mirrors src/app/api/ai/models/route.ts.
async function listAvailableModels(apiKey: string): Promise<Set<string>> {
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) return new Set()
    const j = (await r.json()) as { data?: Array<{ id: string }> }
    return new Set((j.data || []).map((m) => m.id))
  } catch {
    return new Set()
  }
}

// Pick the model to search with.
//
// WHY WE DON'T JUST TRUST ai_settings: the Settings dropdown merges the live
// catalogue with a hard-coded fallback list (api/ai/models/route.ts), so it can
// offer — and save — a model id this account cannot actually call. That is a
// real thing that happened: `gpt-5.5-mini` was configured and every scan died
// with "400 The requested model does not exist". So we verify against the live
// list and degrade to something real instead of failing.
async function resolveModel(apiKey: string): Promise<string> {
  const prefs: string[] = []
  if (process.env.OPPORTUNITIES_MODEL) prefs.push(process.env.OPPORTUNITIES_MODEL)
  try {
    const cfg = await getAiConfig()
    if (cfg.provider === 'openai' && cfg.chatModel) prefs.push(cfg.chatModel)
  } catch {
    /* settings unreadable — the preference list below still stands */
  }
  prefs.push(...PREFERRED_MODELS)

  const available = await listAvailableModels(apiKey)
  // Couldn't read the catalogue (network/permission) — don't block the scan,
  // just take the top preference and let any error surface normally.
  if (available.size === 0) return prefs[0] || PREFERRED_MODELS[0]

  for (const p of prefs) if (p && available.has(p)) return p

  // Nothing we know about is available — take the newest generic gpt-* model
  // the account does have rather than giving up.
  const generic = [...available]
    .filter((id) => /^gpt-/i.test(id) && !NOT_CHAT.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  if (generic[0]) return generic[0]

  throw new Error('ما فيه أي موديل OpenAI متاح لهذا المفتاح — راجع إعدادات الذكاء.')
}

export async function runScan(opts: { trigger: ScanTrigger; by?: string | null }): Promise<ScanResult> {
  const run = await beginRun(opts.trigger, opts.by ?? null)
  if (!run) return { ok: false, found: 0, added: 0, error: null, skipped: true }

  try {
    const apiKey = await getOpenAiKey()
    if (!apiKey) throw new Error('مفتاح OpenAI غير مضبوط — افتح الإعدادات وأضفه.')

    const model = await resolveModel(apiKey)
    const client = new OpenAI({ apiKey })

    const tuning = isReasoningModel(model)
      ? { reasoning: { effort: 'medium' as const } }
      : { temperature: 0.2 }

    const res = await client.responses.create({
      model,
      instructions: buildInstruction(),
      input: buildUserText(),
      tools: [
        {
          type: 'web_search',
          search_context_size: SEARCH_CONTEXT,
          // Biases the tool's own searches toward Saudi sources/results, which
          // is exactly the scope the owner asked for.
          user_location: {
            type: 'approximate',
            country: 'SA',
            city: 'Riyadh',
            region: 'Riyadh',
            timezone: 'Asia/Riyadh',
          },
        },
      ],
      ...tuning,
      text: {
        format: {
          type: 'json_schema',
          name: 'opportunity_scan',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          schema: RESPONSE_SCHEMA as any,
          strict: true,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const rawText = ((res as { output_text?: string }).output_text || '').trim() || '{}'
    let parsed: { opportunities?: unknown }
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new Error(`الذكاء رجّع رداً غير صالح: ${rawText.slice(0, 200)}`)
    }

    const list = Array.isArray(parsed.opportunities) ? parsed.opportunities : []
    const clean = list
      .slice(0, MAX_RESULTS)
      .map((r) => sanitize(r as RawOpportunity))
      .filter((o): o is NewOpportunity => o !== null)

    const added = await mergeFindings(clean)
    await finishRun({ status: 'done', found: clean.length, added, error: null })
    return { ok: true, found: clean.length, added, error: null }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل البحث عن الفرص'
    await finishRun({ status: 'failed', error })
    return { ok: false, found: 0, added: 0, error }
  }
}
