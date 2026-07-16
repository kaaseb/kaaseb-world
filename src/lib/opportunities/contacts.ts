// "الفرص" — the contact hunt.
//
// WHY THIS IS A SEPARATE STEP: news articles announce projects, they don't
// publish procurement inboxes. "سينومي وقّعت عقداً مع لنكس للمقاولات" tells you
// WHO to call and nothing about HOW. So finding the number is a different job
// from finding the project: you stop reading the news and go read the company —
// its own site, its contact page, its verified profiles.
//
// It runs ON DEMAND (a button on the card), not during the daily scan, because
// most rows are never chased. Paying for a contact hunt on all 32 finds a day
// when the team calls three of them is pure waste — this way the search happens
// exactly when someone decides a lead is worth a phone call.

import OpenAI from 'openai'
import { getOpenAiKey } from '@/lib/ai/config'
import { resolveModel, isReasoningModel, createWithRetry } from './openai-client'
import type { OpportunityContact } from './types'

const MAX_OUTPUT_TOKENS = 2000
const MAX_CONTACTS = 5
const MAX_LEN = 200

const log = (msg: string) => console.log(`[الفرص/تواصل] ${msg}`)

const CONTACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contacts'],
  properties: {
    contacts: {
      type: 'array',
      description: `Up to ${MAX_CONTACTS} PUBLISHED business contact points. Empty if none are published.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'email', 'phone', 'website', 'source'],
        properties: {
          name: { type: 'string', description: 'Company or department name, e.g. "إدارة المشتريات".' },
          role: { type: 'string', description: 'Procurement / Tenders / Main office / Sales. Empty if unknown.' },
          email: { type: 'string', description: 'Published business email, else empty string.' },
          phone: { type: 'string', description: 'Published business phone, else empty string.' },
          website: { type: 'string', description: 'Official website or contact page, else empty string.' },
          source: { type: 'string', description: 'The exact URL this was published on.' },
        },
      },
    },
  },
} as const

function buildInstruction(): string {
  return `أنت باحث بيانات أعمال لشركة "كاسب" السعودية (توريد وتركيب رخام وجرانيت).
مهمتك: تلقى **بيانات التواصل التجارية المنشورة رسمياً** لجهة محددة، عشان فريق المبيعات يكلّمهم.

## وين تدوّر (بالترتيب)
1. **الموقع الرسمي للشركة** — صفحة "اتصل بنا" / "تواصل معنا" / Contact Us. هذا المصدر الأول.
2. **صفحة المشتريات/الموردين** إن وجدت (Suppliers / Vendor Registration / التسجيل كمورد) — **الأثمن لنا**.
3. **السجل التجاري / الغرفة التجارية / دليل المقاولين** (الهيئة السعودية للمقاولين sca.sa).
4. **صفحة LinkedIn الرسمية للشركة** أو حسابها الموثّق على X.
5. **بوابة اعتماد (etimad.sa)** لو الجهة حكومية.

## قواعد صارمة — لا تتساهل فيها
- **ممنوع الاختراع منعاً باتاً.** لا تخمّن إيميلاً من نمط (مثل info@اسم-الشركة.com) ولا تركّب رقماً. **كل قيمة لازم تكون منشورة حرفياً في صفحة تقدر تعطي رابطها.**
- **\`source\` إلزامي** لكل صف — الرابط الدقيق اللي نُشرت فيه المعلومة. بدون رابط = لا ترجع الصف.
- **بيانات أعمال فقط**: إيميل/هاتف الشركة أو الإدارة (مشتريات، مناقصات، المكتب الرئيسي، المبيعات). **ممنوع** بيانات شخصية لأفراد (جوال موظف، إيميل شخصي).
- **ما لقيت شي منشور؟ أرجع \`contacts: []\`.** مصفوفة فارغة **أفضل بكثير** من معلومة مخترعة — رقم غلط يضيع وقت الفريق ويحرقنا مع العميل.
- الأفضلية للإيميل والهاتف الرسمي، ثم صفحة التواصل.

أرجع JSON فقط.`
}

function buildUserText(owner: string, project: string, city: string): string {
  return `الجهة المطلوبة: **${owner}**
${project ? `سياق المشروع: ${project}` : ''}
${city ? `المدينة: ${city}` : ''}

ابحث في الإنترنت عن بيانات التواصل التجارية **المنشورة رسمياً** لهذه الجهة في السعودية:
- إيميل وهاتف المكتب الرئيسي
- إيميل/هاتف إدارة المشتريات أو الموردين (الأهم لنا)
- الموقع الرسمي وصفحة التواصل

ابدأ بالموقع الرسمي للشركة وصفحة "اتصل بنا". كل معلومة لازم يكون لها رابط في \`source\`. ما لقيت؟ أرجع مصفوفة فارغة. JSON فقط.`
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

function sanitize(v: unknown): OpportunityContact[] {
  if (!Array.isArray(v)) return []
  const out: OpportunityContact[] = []
  for (const raw of v.slice(0, MAX_CONTACTS)) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const email = str(c.email, MAX_LEN)
    const contact: OpportunityContact = {
      name: str(c.name, MAX_LEN),
      role: str(c.role, MAX_LEN),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      phone: str(c.phone, 40),
      website: httpUrl(c.website),
      source: httpUrl(c.source),
    }
    // No way to reach anyone = noise. No source = unverifiable, and this whole
    // feature is worthless the moment the team stops trusting the numbers.
    if (!contact.email && !contact.phone && !contact.website) continue
    if (!contact.source) continue
    out.push(contact)
  }
  return out
}

export async function huntContacts(input: {
  owner: string
  project?: string
  city?: string
}): Promise<OpportunityContact[]> {
  const apiKey = await getOpenAiKey()
  if (!apiKey) throw new Error('مفتاح OpenAI غير مضبوط — افتح الإعدادات وأضفه.')

  const model = await resolveModel(apiKey)
  const client = new OpenAI({ apiKey })
  log(`hunting for "${input.owner}" (model=${model})`)

  const tuning = isReasoningModel(model)
    ? { reasoning: { effort: 'low' as const } }
    : { temperature: 0.1 }

  const res = await createWithRetry(client, {
    model,
    instructions: buildInstruction(),
    input: buildUserText(input.owner, input.project || '', input.city || ''),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    tools: [
      {
        type: 'web_search',
        search_context_size: 'medium',
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
        name: 'contact_hunt',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: CONTACT_SCHEMA as any,
        strict: true,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  const rawText = ((res as { output_text?: string }).output_text || '').trim() || '{}'
  let parsed: { contacts?: unknown }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error(`رد غير صالح: ${rawText.slice(0, 150)}`)
  }

  const contacts = sanitize(parsed.contacts)
  log(`hunt for "${input.owner}" → ${contacts.length} contact(s)`)
  return contacts
}
