// Convert a pulled email (or a whole pooled thread) into a client_project.
//
// This is the bridge the whole intake exists for: an email with 200 attachments
// becomes a /projects row whose files are already sorted into BOQ / drawing /
// spec / other buckets — which is exactly what Furn's AND Tannoor's import cards
// consume. So the chain completes: Titan → inbox → /projects → الفرن/التنّور.
//
// An AI call refines the sorting and pulls the client/engineer details out of the
// email (names in BOTH languages, engineer + phone from the SIGNATURE). It is
// STRICTLY optional: if the model is unavailable or errors, we fall back to the
// deterministic heuristics, so a convert never fails just because the AI did.
//
// The email BODY is always saved as a source file too — sometimes the BOQ itself
// (or the customer's requirements) lives in the message text, not an attachment,
// and the pricing engines must be able to read it.

import { createHash } from 'crypto'
import { getProvider } from '@/lib/ai'
import { uploadBufferToS3 } from '@/lib/s3'
import type { InboxEmail } from './store'

export interface ConvertDraft {
  name_ar: string
  name_en: string | null
  company_ar: string | null
  company_en: string | null
  engineer_name_ar: string | null
  engineer_name_en: string | null
  engineer_phone: string | null
  notes: string
  files: Array<{
    url: string
    name: string
    key: string
    bytes: number
    category: 'boq' | 'spec' | 'drawing' | 'other'
  }>
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectName_ar', 'projectName_en', 'company_ar', 'company_en', 'engineer_ar', 'engineer_en', 'phone', 'files'],
  properties: {
    projectName_ar: { type: 'string', description: 'Short project title in ARABIC. Empty string if unclear.' },
    projectName_en: { type: 'string', description: 'Same project title in ENGLISH. If only one language is present, TRANSLATE to fill this. Empty only if genuinely unknown.' },
    company_ar: { type: 'string', description: 'Client company name in ARABIC, else empty string.' },
    company_en: { type: 'string', description: 'Client company name in ENGLISH (transliterate/translate if needed), else empty string.' },
    engineer_ar: { type: 'string', description: 'Contact person / engineer name in ARABIC, read from the email SIGNATURE. Empty string if none.' },
    engineer_en: { type: 'string', description: 'Same engineer name in ENGLISH (transliterate the Arabic if needed). Empty string if none.' },
    phone: { type: 'string', description: 'The engineer/contact mobile number, read from the SIGNATURE block. Keep the digits as written (+966…, 05…). Empty string if none.' },
    files: {
      type: 'array',
      description: 'One entry per attachment, in the SAME ORDER given, classifying each.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'category'],
        properties: {
          name: { type: 'string' },
          category: { type: 'string', enum: ['boq', 'spec', 'drawing', 'other'] },
        },
      },
    },
  },
} as const

interface RawClassification {
  projectName_ar?: unknown
  projectName_en?: unknown
  company_ar?: unknown
  company_en?: unknown
  engineer_ar?: unknown
  engineer_en?: unknown
  phone?: unknown
  files?: unknown
}

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// The project notes: sender + date + body preview + the requirements the customer
// asked us to answer (so the pricer sees them right on the project).
function buildNotes(email: InboxEmail): string {
  const reqs = email.preview?.requirements || []
  const lines = [
    `من: ${email.fromName || ''} <${email.fromEmail || ''}>`,
    email.date ? `التاريخ: ${email.date.slice(0, 10)}` : '',
  ]
  if (reqs.length > 0) {
    lines.push('', '⭐ الشروط المطلوبة من العميل:')
    for (const r of reqs) lines.push(`• ${r}`)
  }
  if (email.bodyText) lines.push('', email.bodyText.slice(0, 1500))
  lines.push('', '— محوّل من صندوق بريد Titan')
  return lines.filter((l) => l !== undefined).join('\n')
}

// Build the project draft from the email. The heuristic result is always valid
// on its own; the AI only ever improves it.
export async function buildProjectDraft(email: InboxEmail): Promise<ConvertDraft> {
  // Deterministic baseline — never fails. Prefer the stage-1 summary's project
  // name (what the owner already saw in the inbox) over the raw subject.
  const draft: ConvertDraft = {
    name_ar: email.preview?.projectName || email.subject || 'مشروع من البريد',
    name_en: null,
    company_ar: email.fromName || email.fromEmail || null,
    company_en: null,
    engineer_name_ar: null,
    engineer_name_en: null,
    engineer_phone: null,
    notes: buildNotes(email),
    files: email.attachments.map((a) => ({
      url: a.url, name: a.name, key: a.key, bytes: a.bytes, category: a.category,
    })),
  }

  // AI extraction (best-effort) — names in both languages + engineer/phone.
  if (email.attachments.length > 0 || email.bodyText) {
    try {
      const provider = await getProvider()
      const fileList = email.attachments.map((a, i) => `${i + 1}. ${a.name}`).join('\n')
      const parsed = await provider.generateStructured<RawClassification>({
        systemInstruction:
          'أنت مساعد إدخال مشاريع لشركة رخام سعودية. من إيميل عميل + قائمة مرفقاته، استخرج: اسم المشروع (عربي وإنجليزي)، اسم الشركة (عربي وإنجليزي)، واسم المهندس ورقم جواله من كتلة التوقيع في نهاية الإيميل (عربي وإنجليزي). إذا وجدت الاسم بلغة واحدة فقط فترجمه/انقله للغة الأخرى تلقائياً حتى تمتلئ اللغتان. صنّف كل مرفق: boq (جدول كميات/إكسل) • drawing (رسمة/مخطط) • spec (مواصفات) • other. لا تخترع بيانات — اترك الحقل فارغاً إذا لم يُذكر إطلاقاً. رتّب files بنفس ترتيب القائمة المعطاة.',
        files: [],
        userText: `العنوان: ${email.subject}\nمن: ${email.fromName} <${email.fromEmail}>\n\nنص الإيميل:\n${email.bodyText.slice(0, 3000)}\n\nالمرفقات:\n${fileList || '(لا مرفقات)'}`,
        schema: CLASSIFY_SCHEMA,
        schemaName: 'email_intake',
        temperature: 0.1,
      })

      if (str(parsed.projectName_ar)) draft.name_ar = str(parsed.projectName_ar, 200)
      if (str(parsed.projectName_en)) draft.name_en = str(parsed.projectName_en, 200)
      if (str(parsed.company_ar)) draft.company_ar = str(parsed.company_ar, 200)
      if (str(parsed.company_en)) draft.company_en = str(parsed.company_en, 200)
      if (str(parsed.engineer_ar)) draft.engineer_name_ar = str(parsed.engineer_ar, 200)
      if (str(parsed.engineer_en)) draft.engineer_name_en = str(parsed.engineer_en, 200)
      if (str(parsed.phone)) draft.engineer_phone = str(parsed.phone, 40)

      // Re-bucket by matching the model's classification back to our files by name.
      if (Array.isArray(parsed.files)) {
        const byName = new Map<string, 'boq' | 'spec' | 'drawing' | 'other'>()
        for (const f of parsed.files) {
          if (!f || typeof f !== 'object') continue
          const name = str((f as Record<string, unknown>).name)
          const cat = str((f as Record<string, unknown>).category)
          if (name && (cat === 'boq' || cat === 'spec' || cat === 'drawing' || cat === 'other')) {
            byName.set(name, cat)
          }
        }
        draft.files = draft.files.map((f) => ({ ...f, category: byName.get(f.name) ?? f.category }))
      }
    } catch {
      // AI unavailable/failed — the deterministic draft stands.
    }
  }

  // Fill the other language from the one we have, so the project options are
  // complete without manual typing (owner's request).
  if (!draft.name_en && draft.name_ar) draft.name_en = draft.name_ar
  if (!draft.company_en && draft.company_ar) draft.company_en = draft.company_ar
  if (!draft.company_ar && draft.company_en) draft.company_ar = draft.company_en
  if (!draft.engineer_name_en && draft.engineer_name_ar) draft.engineer_name_en = draft.engineer_name_ar

  // Always attach the email body as a readable source — the BOQ or the terms are
  // sometimes in the message text itself. It becomes a BOQ source when no BOQ
  // file is attached (so the engines still read quantities), else a supporting
  // 'other' source. Failure here must not sink the whole convert.
  if (email.bodyText && email.bodyText.trim().length > 20) {
    try {
      const hasBoq = draft.files.some((f) => f.category === 'boq')
      const header = `# نص الإيميل — ${email.subject}\nمن: ${email.fromName || email.fromEmail}\n\n`
      const buf = Buffer.from(header + email.bodyText, 'utf8')
      const hid = createHash('sha1').update(email.id).digest('hex').slice(0, 16)
      const up = await uploadBufferToS3({
        buffer: buf,
        key: `inbox-body/${hid}.txt`,
        contentType: 'text/plain; charset=utf-8',
      })
      draft.files.push({
        url: up.url,
        name: `نص-الإيميل-${email.subject || 'رسالة'}`.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) + '.txt',
        key: up.key,
        bytes: up.bytes,
        category: hasBoq ? 'other' : 'boq',
      })
    } catch {
      /* body-as-file is a bonus, not a requirement */
    }
  }

  return draft
}
