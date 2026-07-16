// "شركات مستهدفة" — the account-list builder.
//
// Same engine shape as the opportunities scout (one small per-sector Responses
// call with web_search + strict JSON, capped output, spaced apart) — see
// lib/opportunities/search.ts for why that shape exists.
//
// The DIFFERENCE is what it hunts. The scout reads the news for projects that
// are happening. This reads the market for companies that buy marble for a
// living: who they are, how big, what they've built, and how to get in. A
// project expires; a contractor with a procurement desk does not.

import OpenAI from 'openai'
import { getOpenAiKey } from '@/lib/ai/config'
import { resolveModel, isReasoningModel, createWithRetry } from '@/lib/opportunities/openai-client'
import {
  COMPANY_CATEGORY_KEYS,
  COMPANY_SIZE_KEYS,
  companyCategoryLabel,
  isValidCompanyCategory,
  type CompanyCategory,
  type CompanyContact,
  type CompanySize,
  type CompanyScanTrigger,
} from './types'
import { beginCompanyRun, finishCompanyRun, mergeCompanies, existingNames, type NewCompany } from './store'

const MAX_PER_SECTOR = 8
const MAX_OUTPUT_TOKENS = 10_000
const SEARCH_CONTEXT: 'low' | 'medium' | 'high' = 'medium'
const SECTOR_GAP_MS = 10_000

const MAX_LEN = { name: 160, summary: 500, projects: 500, why: 400, targeting: 700, city: 80, contact: 200 }
const MAX_CONTACTS = 4
const MAX_URLS = 4

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (msg: string) => console.log(`[شركات] ${msg}`)

// The Saudi market, sliced into places you can actually search.
//
// WHY ROTATE: "who are Saudi Arabia's big contractors" has one answer, and the
// model gives you the same famous names forever. Pointing each run at a
// different region asks a question that has a NEW answer every time, so a month
// of scans walks the whole map instead of re-reading the same page 30 times.
// Costs nothing extra — same four calls, better question.
const REGIONS = [
  'الرياض',
  'جدة',
  'الدمام والخبر والظهران',
  'مكة المكرمة',
  'المدينة المنورة',
  'القصيم وبريدة وعنيزة',
  'الأحساء والهفوف',
  'أبها وخميس مشيط وعسير',
  'تبوك',
  'حائل',
  'الطائف',
  'ينبع',
  'الجبيل',
  'جازان',
  'نجران والباحة',
]

// Each sector gets a different region on the same day, so one run covers four
// slices of the map, not one.
function regionForToday(sectorIndex: number): string {
  const day = Math.floor(Date.now() / 86_400_000)
  return REGIONS[(day * COMPANY_CATEGORY_KEYS.length + sectorIndex) % REGIONS.length]
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['companies'],
  properties: {
    companies: {
      type: 'array',
      description: `Up to ${MAX_PER_SECTOR} real, verified Saudi companies. Fewer is better than invented.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name', 'category', 'size', 'city', 'summary',
          'projects', 'whyRelevant', 'targeting', 'contacts', 'score', 'sourceUrls',
        ],
        properties: {
          name: { type: 'string', description: 'Official company name as published.' },
          category: { type: 'string', enum: COMPANY_CATEGORY_KEYS },
          size: { type: 'string', enum: COMPANY_SIZE_KEYS },
          city: { type: 'string', description: 'HQ city in Saudi Arabia. Empty string if unknown.' },
          summary: { type: 'string', description: '1-2 sentences: what they build/do.' },
          projects: { type: 'string', description: 'Notable projects they delivered or are delivering — the proof.' },
          whyRelevant: { type: 'string', description: 'The marble/granite volume and type they realistically consume.' },
          targeting: { type: 'string', description: 'Concrete approach in Arabic: who to contact and with what.' },
          contacts: {
            type: 'array',
            description: 'PUBLIC business contacts only, each with a source URL. Empty array if none published.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'role', 'email', 'phone', 'website', 'source'],
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                website: { type: 'string' },
                source: { type: 'string' },
              },
            },
          },
          score: { type: 'number', description: '0-100: how valuable as a marble customer. Be honest.' },
          sourceUrls: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

interface RawCompany {
  name?: unknown
  category?: unknown
  size?: unknown
  city?: unknown
  summary?: unknown
  projects?: unknown
  whyRelevant?: unknown
  targeting?: unknown
  contacts?: unknown
  score?: unknown
  sourceUrls?: unknown
}

const SECTOR_BRIEF: Record<CompanyCategory, string> = {
  contractors: `**الهيئة السعودية للمقاولين (sca.sa)** — سجل المقاولين المصنّفين، المصدر الأول.
**تصنيف المقاولين** لدى وزارة الشؤون البلدية • **إفصاحات أرقام/تداول** عن المقاولين المدرجين وترسياتهم.
أمثلة على الطبقة الأولى: البواني، نسما وشركاه، الفوزان القابضة، الخضري، محمد المجدوعي، الراشد للتجارة والمقاولات، شبه الجزيرة، الحبيب، العثيم، سعودي بن لادن، الرشيد للتطوير.`,

  finishing: `شركات **التشطيبات والديكور والتصميم الداخلي** (Fit-out / Interior Contracting) في السعودية — هؤلاء **أقرب مشترٍ للرخام** لأن الحجر شغلهم المباشر.
ابحث في: دليل الغرف التجارية، LinkedIn (شركات Fit-out بالسعودية)، معارض التصميم الداخلي، مقاولي الباطن للتشطيبات في مشاريع الفنادق والمولات.`,

  developers: `**المطوّرون العقاريون**: روشن (roshn.sa)، الوطنية للإسكان (nhc.sa)، دار الأركان، رتال، الأندلس العقارية، سمو، جبل عمر، إعمار المدينة الاقتصادية، مدينة الملك عبدالله الاقتصادية.
وأيضاً المطوّرون المتوسطون في الرياض وجدة والدمام — هؤلاء يبنون بشكل متكرر ويحتاجون مورّد ثابت.`,

  consultants: `**المكاتب الهندسية والاستشارية** — هؤلاء **يكتبون المواصفات** التي تحدد أي رخام يُشترى. الدخول معهم يعني أن تُذكر موادنا في المواصفات من البداية.
ابحث في: الهيئة السعودية للمهندسين (saudieng.sa)، مكاتب التصميم المعماري الكبرى بالسعودية، الاستشاريين في المشاريع العملاقة.`,
}

function buildInstruction(category: CompanyCategory): string {
  return `أنت محلل تطوير أعمال لشركة "كاسب" السعودية، متخصصة في **توريد وتركيب الرخام والجرانيت الطبيعي**.
مهمتك: تبني **قائمة عملاء مستهدفين** — شركات سعودية حقيقية **تشتري رخام بحكم عملها**.
القسم المطلوب الآن: **"${companyCategoryLabel(category, 'ar')}"** فقط، في **السعودية فقط**.

## الفرق المهم عن البحث عن مشاريع
ما ندوّر على **خبر** — ندوّر على **شركة**. المشروع ينتهي، لكن المقاول اللي عنده إدارة مشتريات يظل عميلاً محتملاً لكل مشروع يفوز فيه لاحقاً. فركّز على **من هم**، **كم حجمهم**، **وش بنوا**، و**كيف ندخل عليهم**.

## مصادر هذا القسم
${SECTOR_BRIEF[category]}

## القواعد الصارمة
1. **السعودية فقط** — شركات تعمل في المملكة.
2. **شركات حقيقية موجودة فقط.** ممنوع اختراع أسماء. كل شركة لازم يكون لها **رابط مصدر** يثبت وجودها (موقعها الرسمي، سجل الهيئة، خبر، LinkedIn).
3. **جهات التواصل: منشورة رسمياً فقط** ولكل واحدة **رابط مصدر** إلزامي. ممنوع تخمين إيميلات بالنمط (info@...) أو تركيب أرقام. ما لقيت؟ **أرجع \`contacts: []\`** — الفريق عنده زر يبحث عن التواصل لاحقاً، فلا تخترع.
4. **\`projects\` هو الإثبات** — اذكر مشاريع فعلية نفّذوها أو ينفذونها. شركة بلا مشاريع معروفة = درجة منخفضة.
5. **\`whyRelevant\`**: كم وأي نوع رخام يستهلكون واقعياً (مثال: "مقاول أبراج سكنية — أرضيات لوبيات ودرج وحمامات، استهلاك متكرر متوسط-عالي").
6. **\`targeting\`**: خطوات عملية بالعربي — مين نكلّم (إدارة المشتريات؟ مدير المشاريع؟)، وش نجهّز (عيّنات؟ ملف تعريفي؟ تسجيل مورد؟)، ومتى.
7. **\`score\` صادق**: 80-100 = مشترٍ ضخم ومتكرر وواضح. 50-79 = جيد. 1-49 = صغير أو معلومات ناقصة.
8. **\`category\` لازم يكون \`${category}\`** لكل الصفوف.
9. أقصى عدد: **${MAX_PER_SECTOR}**.

اكتب \`summary\` و\`projects\` و\`whyRelevant\` و\`targeting\` **بالعربي**. أرجع JSON فقط.`
}

function buildUserText(category: CompanyCategory, region: string, known: string[]): string {
  // The exclusion list is the difference between a productive scan and paying
  // to rediscover البواني for the thirtieth time.
  const exclusion =
    known.length > 0
      ? `\n\n## 🚫 عندنا هؤلاء بالفعل — **لا ترجع أياً منهم إطلاقاً**، ابحث عن شركات **غيرهم**:
${known.map((n) => `- ${n}`).join('\n')}

لو كل اللي تلقاه من القائمة أعلاه، **وسّع بحثك**: شركات أصغر، مدن أصغر داخل المنطقة، تخصصات فرعية. **صف واحد جديد أفضل من ثمانية مكررة.**`
      : ''

  return `ابحث الآن في الإنترنت عن شركات سعودية حقيقية ضمن قسم **"${companyCategoryLabel(category, 'ar')}"** تصلح كعملاء لتوريد وتركيب الرخام والجرانيت.

## 📍 ركّز على منطقة: **${region}**
ابحث عن الشركات اللي مقرها أو نشاطها الرئيسي في **${region}**. لو ما لقيت ما يكفي فيها، وسّع للمناطق المجاورة — بس ابدأ منها.${exclusion}

لكل شركة: اسمها الرسمي، مقرها، حجمها، مشاريعها الفعلية (إثبات)، وكم رخام تستهلك واقعياً، وطريقة عملية للدخول عليها. وثّق كل شركة برابط.

أرجع حتى ${MAX_PER_SECTOR} شركات **جديدة**. JSON فقط.`
}

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

function sanitizeContacts(v: unknown): CompanyContact[] {
  if (!Array.isArray(v)) return []
  const out: CompanyContact[] = []
  for (const raw of v.slice(0, MAX_CONTACTS)) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const email = str(c.email, MAX_LEN.contact)
    const contact: CompanyContact = {
      name: str(c.name, MAX_LEN.contact),
      role: str(c.role, MAX_LEN.contact),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      phone: str(c.phone, 40),
      website: httpUrl(c.website),
      source: httpUrl(c.source),
    }
    if (!contact.email && !contact.phone && !contact.website) continue
    out.push(contact)
  }
  return out
}

function sanitize(raw: RawCompany, expected: CompanyCategory): NewCompany | null {
  const name = str(raw.name, MAX_LEN.name)
  if (!name) return null

  const category: CompanyCategory = isValidCompanyCategory(raw.category) ? raw.category : expected
  const size = (COMPANY_SIZE_KEYS as string[]).includes(raw.size as string)
    ? (raw.size as CompanySize)
    : 'unknown'

  const scoreNum = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0
  const score = Math.max(0, Math.min(100, Math.round(scoreNum)))

  const sourceUrls = Array.isArray(raw.sourceUrls)
    ? Array.from(new Set(raw.sourceUrls.map(httpUrl).filter(Boolean))).slice(0, MAX_URLS)
    : []

  return {
    name,
    category,
    size,
    city: str(raw.city, MAX_LEN.city),
    summary: str(raw.summary, MAX_LEN.summary),
    projects: str(raw.projects, MAX_LEN.projects),
    whyRelevant: str(raw.whyRelevant, MAX_LEN.why),
    targeting: str(raw.targeting, MAX_LEN.targeting),
    contacts: sanitizeContacts(raw.contacts),
    score,
    sourceUrls,
  }
}

async function scanSector(
  client: OpenAI,
  model: string,
  category: CompanyCategory,
  region: string,
  known: string[],
): Promise<NewCompany[]> {
  const tuning = isReasoningModel(model)
    ? { reasoning: { effort: 'low' as const } }
    : { temperature: 0.2 }

  const res = await createWithRetry(client, {
    model,
    instructions: buildInstruction(category),
    input: buildUserText(category, region, known),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    tools: [
      {
        type: 'web_search',
        search_context_size: SEARCH_CONTEXT,
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
        name: 'company_scan',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: RESPONSE_SCHEMA as any,
        strict: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  const rawText = ((res as { output_text?: string }).output_text || '').trim() || '{}'
  let parsed: { companies?: unknown }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error(`رد غير صالح: ${rawText.slice(0, 150)}`)
  }

  const list = Array.isArray(parsed.companies) ? parsed.companies : []
  return list
    .slice(0, MAX_PER_SECTOR)
    .map((r) => sanitize(r as RawCompany, category))
    .filter((c): c is NewCompany => c !== null)
}

export interface CompanyScanResult {
  ok: boolean
  found: number
  added: number
  error: string | null
  skipped?: boolean
}

export async function runCompanyScan(opts: {
  trigger: CompanyScanTrigger
  by?: string | null
}): Promise<CompanyScanResult> {
  const run = await beginCompanyRun(opts.trigger, opts.by ?? null)
  if (!run) return { ok: false, found: 0, added: 0, error: null, skipped: true }

  try {
    const apiKey = await getOpenAiKey()
    if (!apiKey) throw new Error('مفتاح OpenAI غير مضبوط — افتح الإعدادات وأضفه.')

    const model = await resolveModel(apiKey)
    const client = new OpenAI({ apiKey })
    log(`scan start — trigger=${opts.trigger} model=${model}`)

    let found = 0
    let added = 0
    const errors: string[] = []

    // Read once, not per sector — the list barely moves inside a single run.
    const known = await existingNames()
    log(`excluding ${known.length} known compan(ies) from this scan`)

    for (let i = 0; i < COMPANY_CATEGORY_KEYS.length; i++) {
      const category = COMPANY_CATEGORY_KEYS[i]
      const region = regionForToday(i)
      const t0 = Date.now()
      try {
        const rows = await scanSector(client, model, category, region, known)
        found += rows.length
        const n = await mergeCompanies(rows)
        added += n
        log(`sector ${category} [${region}]: found=${rows.length} added=${n} (${Math.round((Date.now() - t0) / 1000)}s)`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'فشل'
        errors.push(`${companyCategoryLabel(category, 'ar')}: ${msg}`)
        log(`sector ${category} FAILED (${Math.round((Date.now() - t0) / 1000)}s): ${msg}`)
      }
      if (i < COMPANY_CATEGORY_KEYS.length - 1) await sleep(SECTOR_GAP_MS)
    }

    const allFailed = errors.length === COMPANY_CATEGORY_KEYS.length
    const error = errors.length ? errors.join(' • ') : null
    await finishCompanyRun({ status: allFailed ? 'failed' : 'done', found, added, error })
    log(`scan done — found=${found} added=${added} errors=${errors.length}`)
    return { ok: !allFailed, found, added, error }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل البحث عن الشركات'
    await finishCompanyRun({ status: 'failed', error })
    return { ok: false, found: 0, added: 0, error }
  }
}
