// "الفرص" (Opportunities) — the scout.
//
// ONE small OpenAI Responses call PER SECTOR, each with the built-in
// `web_search` tool and a strict json_schema response. No scraping, no crawler,
// no third-party search key.
//
// WHY PER-SECTOR AND NOT ONE BIG CALL (learned the hard way, in production):
// a single combined request reserved ~46-67k tokens against the org's 200k
// tokens-per-minute ceiling — mostly because an uncapped `max_output_tokens`
// makes OpenAI reserve the model's whole output budget up front. Retries then
// reserved it again, and the scan strangled itself with 429s. Four focused
// requests, each capped and spaced apart, never come close to the ceiling.
// They also search better: each sector gets its own sources, and one sector
// failing no longer loses the entire run.
//
// Cost control (the owner's explicit ask — "خفيفة والسحب قليل"):
//   • one scan per day (plus the occasional manual click)
//   • MAX_PER_SECTOR caps what comes back
//   • MAX_OUTPUT_TOKENS caps the reservation AND the bill
//   • reasoning effort 'low' — this is extraction, not deep thought
//   • beginRun() in the store refuses to stack a second scan on a running one
//
// Everything the model returns is treated as untrusted: validated, clamped and
// trimmed in sanitize() before it can reach S3.

import OpenAI from 'openai'
import { getOpenAiKey } from '@/lib/ai/config'
import { resolveModel, isReasoningModel, createWithRetry } from './openai-client'
import {
  CATEGORY_KEYS,
  STAGE_KEYS,
  categoryLabel,
  isValidCategory,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityContact,
  type OpportunityStage,
  type ScanTrigger,
} from './types'
import { beginRun, finishRun, mergeFindings, existingTitles, type NewOpportunity } from './store'
import { notifyHighValue } from './notify'

// Per sector. Four sectors → up to 32 finds a day. The list also ACCUMULATES:
// dedup means every day adds only what's new, so a week is ~200 leads, not 32.
const MAX_PER_SECTOR = 8

// The single most important number here. Without it OpenAI reserves the model's
// full output budget against your TPM limit and one scan can eat a third of the
// minute. Scaled with MAX_PER_SECTOR — 8 opportunities of JSON need more room.
const MAX_OUTPUT_TOKENS = 10_000

// How far back the news sweep looks. Wider than the daily cadence on purpose —
// dedup in the store kills the overlap, and it means a missed day self-heals.
const LOOKBACK_DAYS = 14

// 'low' | 'medium' | 'high' — how much of the page text the tool pulls in.
const SEARCH_CONTEXT: 'low' | 'medium' | 'high' = 'medium'

// Breathing room between sectors so four requests never land in the same TPM
// window as each other.
const SECTOR_GAP_MS = 10_000

// Field caps. The model is told to be brief; this is the hard stop.
const MAX_LEN = { title: 160, summary: 600, relevance: 400, targeting: 700, city: 80, owner: 160, contact: 200 }
const MAX_CONTACTS = 4
const MAX_URLS = 4

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Same tag the scheduler uses, so `pm2 logs | grep الفرص` shows the whole story.
const log = (msg: string) => console.log(`[الفرص] ${msg}`)

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
      description: `Up to ${MAX_PER_SECTOR} verified opportunities. Fewer is better than invented.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'summary', 'category', 'stage', 'city', 'owner',
          'contacts', 'relevance', 'targeting', 'score', 'sourceUrls', 'publishedAt',
        ],
        properties: {
          title: { type: 'string', description: 'Project name as published. Arabic or English, as found.' },
          summary: { type: 'string', description: '1-3 sentences: what the project is, size/value if published, and the other party (owner or contractor).' },
          category: { type: 'string', enum: CATEGORY_KEYS },
          stage: { type: 'string', enum: STAGE_KEYS },
          city: { type: 'string', description: 'City/region in Saudi Arabia. Empty string if not stated.' },
          owner: {
            type: 'string',
            description:
              'WHO WE TARGET. Prefer the main contractor (the actual marble buyer) when known; otherwise the developer/government entity.',
          },
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

// ─── prompts ────────────────────────────────────────────────────────────────

// Where each sector actually lives on the Saudi web. Keeping these per-sector
// (instead of one giant source dump) is what makes each small request hit.
const SECTOR_BRIEF: Record<OpportunityCategory, string> = {
  government: `**اعتماد (etimad.sa)** — بوابة المنافسات والمشتريات الحكومية، المصدر الأول للمناقصات.
**الهيئة الملكية لمدينة الرياض (rcrc.gov.sa)** • **وزارة الشؤون البلدية والقروية والإسكان (momrah.gov.sa)** • **صندوق الاستثمارات العامة (pif.gov.sa)**.
المشاريع العملاقة: **نيوم (neom.com)** • **القدية (qiddiya.com)** • **الدرعية (diriyah.sa)** • **البحر الأحمر (redseaglobal.com)** • **المربع الجديد (newmurabba.com)** • أمالا • السودة للتطوير • مسار مكة • مطار الملك سلمان الدولي.
حسابات X الرسمية: @Etimad_sa @NEOM @Qiddiya @Diriyah @RedSeaGlobal @PIF_ar @MOMRAHSA.`,

  developers: `**روشن (roshn.sa)** @ROSHN_SA • **الوطنية للإسكان (nhc.sa)** @NHC_SA • **دار الأركان** • **رتال (retal.com.sa)** • **الأندلس العقارية** • **سمو العقارية** • **مدينة الملك عبدالله الاقتصادية (KAEC)** • **إعمار المدينة الاقتصادية**.
والأهم: **إفصاحات تداول/أرقام** عن عقود إنشاء أبراج ومجمّعات وكمباوندات سكنية — ابحث "ترسية عقد" + "أبراج/مجمع سكني".`,

  commercial: `**إفصاحات أرقام (argaam.com) وتداول (tadawul.com.sa)** عن عقود مولات وفنادق ومستشفيات ومطارات — هنا تلقى اسم المقاول الفائز.
مطار الملك سلمان الدولي • وزارة الصحة (مستشفيات) • سلاسل الفنادق والمجموعات الفندقية • شركات التطوير التجاري • **الاقتصادية (aleqt.com)** و**مباشر** • MEED و Zawya Projects.`,

  landmark: `مشاريع **توسعة الحرمين الشريفين** • **جبل عمر (jabalomar.com.sa)** • **رؤى المدينة** • **رؤى الحرم** • هيئة تطوير مكة المكرمة وهيئة تطوير المدينة المنورة • مشاريع المساجد الكبرى • القصور الخاصة والواجهات الحجرية الفاخرة.
هذي المشاريع أعلى استهلاكاً للرخام الفاخر — انتبه لها.`,
}

// Accounts that AGGREGATE Saudi project news — the owner reads them daily and
// wants the robot reading them too. They are treated as LEADS, not as sources:
// x.com blocks most crawlers, so the scan uses a handle to learn a project NAME
// and then must verify that project on a primary source (Etimad/Argaam/Tadawul/
// the entity's own site) and link THAT. A tweet alone is never enough evidence.
const WATCH_ACCOUNTS = `**@SaudiProject** (x.com/SaudiProject) — يرصد مشاريع السعودية أولاً بأول؛ من أفضل مصادر الرصد المبكر.
**@Saudi_Projects** • **@ArgaamPlus** (أرقام) • **@Tadawul_SA** (تداول) • **@spagov** (واس) • **@Etimad_sa** (اعتماد) • **@MEEDNews** • **@ZawyaProjects**.`

function buildInstruction(category: OpportunityCategory): string {
  return `أنت محلل تطوير أعمال لشركة "كاسب" السعودية، متخصصة في **توريد وتركيب الرخام والجرانيت الطبيعي**.
مهمتك الآن: قسم **"${categoryLabel(category, 'ar')}"** فقط، في **السعودية فقط**.

## 🎯 المنطق الأهم — مين يشتري الرخام فعلاً؟
**ليس مالك المشروع — بل المقاول الرئيسي أو مقاول التشطيبات.** لما تُعلن جهة عن مشروع، الجهة ما تشتري الرخام؛ **المقاول اللي ترسّى عليه العقد** هو اللي يشتري ويتعاقد مع الموردين.

1. **أثمن إشارة = ترسية عقد** (ترسية / توقيع عقد / إسناد). الشركات المدرجة في **تداول ملزمة نظاماً** بالإفصاح عنها في **أرقام (argaam.com)** — اسم المقاول + المشروع + القيمة + المدة. هذا عميلنا بالاسم والتاريخ.
2. في \`owner\` ضع **الجهة اللي نستهدفها**: المقاول الرئيسي لو معروف، وإلا المطوّر/المالك. واذكر الطرف الآخر في \`summary\`.
3. **التوقيت الذهبي:** الرخام يُشترى في **مرحلة التشطيب** — بعد ١٢-٢٤ شهر من بدء التنفيذ. مشروع ترسّى قبل سنة ودخل التشطيب **أثمن** من مشروع أُعلن أمس. اعكس هذا في \`score\`.

## 📚 مصادر هذا القسم
${SECTOR_BRIEF[category]}

## 📡 حسابات الرصد (ابدأ منها كل مرة)
${WATCH_ACCOUNTS}

**كيف تستخدمها — مهم:** هذي الحسابات **دليل لا مصدر**. ابحث عن أحدث ما نشرته عن مشاريع سعودية (ابحث باسم الحساب وبأسماء المشاريع اللي يذكرها). لو تعذّر فتح x.com، **خذ اسم المشروع** من أي اقتباس/إعادة نشر وابحث عنه في المصادر الأولية. ثم **تحقّق من المشروع في مصدر أولي** (اعتماد / أرقام / تداول / الموقع الرسمي للجهة / وكالة أنباء) و\`sourceUrls\` **لازم يحتوي رابط المصدر الأولي**؛ ضِف رابط المنشور بعده إن وُجد. **تغريدة لوحدها ليست دليلاً كافياً** ولا تُرجَع بدون تأكيد أولي.

**سوشيل ميديا مقبول** بشرط أن يكون **حساباً رسمياً موثّقاً للجهة نفسها** أو حساب رصد/صحيفة اقتصادية معتبرة **مع تأكيد أولي**، ومع رابط المنشور في \`sourceUrls\`. ممنوع الحسابات المجهولة والإشاعات.

## القواعد الصارمة
1. **السعودية فقط.** أي مشروع خارج المملكة يُرفض تماماً.
2. **أخبار آخر ${LOOKBACK_DAYS} يوم** (الخبر حديث؛ المشروع نفسه ممكن يكون بدأ قبل فترة وهذا مطلوب).
3. **لا تخترع أبداً.** كل معلومة لازم تكون منشورة فعلاً مع رابط. ما لقيت؟ اترك الحقل فارغاً (أو null للتاريخ). **صفوف أقل وموثّقة أفضل بكثير من صفوف مخترعة.**
4. **جهات التواصل: معلومات أعمال عامة فقط** — منشورة رسمياً من الجهة (موقعها، بوابة مناقصات، بيان صحفي)، على مستوى الشركة أو الإدارة. **ممنوع** بيانات شخصية خاصة أو أرقام/إيميلات مخمّنة. ما فيه تواصل منشور؟ أرجع مصفوفة فارغة.
5. **الصلة بالرخام شرط** — لازم يكون فيه نطاق تشطيبات حجرية محتمل (أرضيات، واجهات، درج، حمامات، لوبيات).
6. **\`category\` لازم يكون \`${category}\`** لكل الصفوف.
7. **\`score\` صادق**: 80-100 = فرصة ضخمة وقريبة وواضحة الجهة. 50-79 = جيدة. 1-49 = ضعيفة أو ناقصة. لا تعطي الكل درجات عالية.
8. أقصى عدد: **${MAX_PER_SECTOR}** فرص.

اكتب \`summary\` و\`relevance\` و\`targeting\` **بالعربي**. \`targeting\` لازم يكون **خطوات عملية محددة** (مين نكلّم، وش نجهّز، وش التوقيت) لا كلام عام. أرجع JSON فقط.`
}

function buildUserText(category: OpportunityCategory, known: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  // Without this the scan re-reads yesterday's headlines, we bin them all as
  // duplicates, and the run honestly reports "added 0" after paying full price.
  const exclusion =
    known.length > 0
      ? `\n\n## 🚫 عندنا هذي الفرص بالفعل — **لا ترجع أياً منها**، ابحث عن **غيرها**:
${known.map((n) => `- ${n}`).join('\n')}

لو كل اللي تلقاه من القائمة أعلاه، **وسّع بحثك**: مصادر أقل شهرة، مشاريع أصغر، مدن ثانية، ترسيات أقدم شوي دخلت التشطيب. **فرصة واحدة جديدة أفضل من ثمانية مكررة.**`
      : ''

  return `تاريخ اليوم: ${today}.
ابحث الآن في الإنترنت عن فرص توريد وتركيب رخام/جرانيت في السعودية ضمن قسم **"${categoryLabel(category, 'ar')}"**، من أخبار آخر ${LOOKBACK_DAYS} يوم.

ابدأ بـ**حسابات الرصد** (خصوصاً @SaudiProject) لالتقاط أحدث المشاريع المعلنة، ثم ابحث عن **ترسيات العقود** في أرقام/تداول، ثم غطِّ مصادر القسم المذكورة. كل فرصة لازم يكون معها **رابط مصدر أولي** يؤكدها. استهدف **المقاول**، وقيّم حسب قرب مرحلة التشطيب.${exclusion}

أرجع حتى ${MAX_PER_SECTOR} فرص **جديدة** موثّقة بروابط حقيقية. JSON فقط.`
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

function sanitize(raw: RawOpportunity, expected: OpportunityCategory): NewOpportunity | null {
  const title = str(raw.title, MAX_LEN.title)
  const owner = str(raw.owner, MAX_LEN.owner)
  if (!title) return null // a row with no project name is unusable

  // Trust the sector we asked for over whatever the model labelled it.
  const category: OpportunityCategory = isValidCategory(raw.category) ? raw.category : expected
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

async function scanSector(
  client: OpenAI,
  model: string,
  category: OpportunityCategory,
  known: string[],
): Promise<NewOpportunity[]> {
  const tuning = isReasoningModel(model)
    ? { reasoning: { effort: 'low' as const } }
    : { temperature: 0.2 }

  const res = await createWithRetry(client, {
    model,
    instructions: buildInstruction(category),
    input: buildUserText(category, known),
    max_output_tokens: MAX_OUTPUT_TOKENS,
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
    throw new Error(`رد غير صالح: ${rawText.slice(0, 150)}`)
  }

  const list = Array.isArray(parsed.opportunities) ? parsed.opportunities : []
  return list
    .slice(0, MAX_PER_SECTOR)
    .map((r) => sanitize(r as RawOpportunity, category))
    .filter((o): o is NewOpportunity => o !== null)
}

// ─── the scan ───────────────────────────────────────────────────────────────

export interface ScanResult {
  ok: boolean
  found: number
  added: number
  error: string | null
  skipped?: boolean // a scan was already running
}

export async function runScan(opts: { trigger: ScanTrigger; by?: string | null }): Promise<ScanResult> {
  const run = await beginRun(opts.trigger, opts.by ?? null)
  if (!run) return { ok: false, found: 0, added: 0, error: null, skipped: true }

  try {
    const apiKey = await getOpenAiKey()
    if (!apiKey) throw new Error('مفتاح OpenAI غير مضبوط — افتح الإعدادات وأضفه.')

    const model = await resolveModel(apiKey)
    const client = new OpenAI({ apiKey })
    // Log to pm2 as we go. Without this the whole scan is invisible on the
    // server and the only evidence of a failure is a string in S3 — which is
    // useless when you're trying to work out WHY it failed.
    log(`scan start — trigger=${opts.trigger} model=${model}`)

    let found = 0
    let added = 0
    const errors: string[] = []
    const addedRows: Opportunity[] = []

    // Read once, not per sector — the list barely moves inside a single run.
    const known = await existingTitles()
    log(`excluding ${known.length} known opportunit(ies) from this scan`)

    for (let i = 0; i < CATEGORY_KEYS.length; i++) {
      const category = CATEGORY_KEYS[i]
      const t0 = Date.now()
      try {
        const rows = await scanSector(client, model, category, known)
        found += rows.length
        // Merge per sector so the page fills in progressively while the rest
        // of the scan is still running.
        const fresh = await mergeFindings(rows)
        added += fresh.length
        addedRows.push(...fresh)
        log(`sector ${category}: found=${rows.length} added=${fresh.length} (${Math.round((Date.now() - t0) / 1000)}s)`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'فشل'
        errors.push(`${categoryLabel(category, 'ar')}: ${msg}`)
        log(`sector ${category} FAILED (${Math.round((Date.now() - t0) / 1000)}s): ${msg}`)
      }
      if (i < CATEGORY_KEYS.length - 1) await sleep(SECTOR_GAP_MS)
    }

    // One notification for the whole scan, not one per sector — four pings at
    // 3 AM is how you get an alert everyone mutes.
    await notifyHighValue(addedRows)
    log(`scan done — found=${found} added=${added} errors=${errors.length}`)

    // Only a total wipeout counts as a failed run — partial results are still
    // results, and the team should see them.
    const allFailed = errors.length === CATEGORY_KEYS.length
    const error = errors.length ? errors.join(' • ') : null
    await finishRun({ status: allFailed ? 'failed' : 'done', found, added, error })
    return { ok: !allFailed, found, added, error }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل البحث عن الفرص'
    await finishRun({ status: 'failed', error })
    return { ok: false, found: 0, added: 0, error }
  }
}
