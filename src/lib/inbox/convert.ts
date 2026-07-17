// Convert a pulled email into a client_project.
//
// This is the bridge the whole intake exists for: an email with 200 attachments
// becomes a /projects row whose files are already sorted into BOQ / drawing /
// spec / other buckets — which is exactly what Furn's ClientProjectImportCard
// consumes. So the chain completes: Titan → inbox → /projects → الفرن/التنّور.
//
// A small AI call refines the sorting and pulls the client/engineer details out
// of the email, but it is STRICTLY optional: if the model is unavailable or
// errors, we fall back to the deterministic heuristics from the pull, so a
// convert never fails just because the AI did.

import { getProvider } from '@/lib/ai'
import type { InboxEmail } from './store'

export interface ConvertDraft {
  name_ar: string
  company_ar: string | null
  engineer_name_ar: string | null
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
  required: ['projectName', 'company', 'engineer', 'phone', 'files'],
  properties: {
    projectName: { type: 'string', description: 'Short project title from the email. Empty string if unclear.' },
    company: { type: 'string', description: 'Client company name, else empty string.' },
    engineer: { type: 'string', description: 'Contact person / engineer name, else empty string.' },
    phone: { type: 'string', description: 'Any phone number in the email, else empty string.' },
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
  projectName?: unknown
  company?: unknown
  engineer?: unknown
  phone?: unknown
  files?: unknown
}

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// Build the project draft from the email. The heuristic result is always valid
// on its own; the AI only ever improves it.
export async function buildProjectDraft(email: InboxEmail): Promise<ConvertDraft> {
  // Deterministic baseline — never fails.
  const draft: ConvertDraft = {
    name_ar: email.subject || 'مشروع من البريد',
    company_ar: email.fromName || email.fromEmail || null,
    engineer_name_ar: null,
    engineer_phone: null,
    notes: [
      `من: ${email.fromName || ''} <${email.fromEmail || ''}>`,
      email.date ? `التاريخ: ${email.date.slice(0, 10)}` : '',
      email.bodyText ? `\n${email.bodyText.slice(0, 1500)}` : '',
      '\n— محوّل من صندوق بريد Titan',
    ].filter(Boolean).join('\n'),
    files: email.attachments.map((a) => ({
      url: a.url, name: a.name, key: a.key, bytes: a.bytes, category: a.category,
    })),
  }

  // No attachments to reason about and no body → nothing for the AI to add.
  if (email.attachments.length === 0 && !email.bodyText) return draft

  try {
    const provider = await getProvider()
    const fileList = email.attachments.map((a, i) => `${i + 1}. ${a.name}`).join('\n')
    const parsed = await provider.generateStructured<RawClassification>({
      systemInstruction:
        'أنت مساعد إدخال مشاريع لشركة رخام سعودية. من إيميل عميل + قائمة مرفقاته، استخرج اسم المشروع والشركة والمهندس ورقم الهاتف، وصنّف كل مرفق: boq (جدول كميات/إكسل) • drawing (رسمة/مخطط) • spec (مواصفات) • other. لا تخترع بيانات — اترك أي حقل فارغاً إذا لم يُذكر. رتّب files بنفس ترتيب القائمة المعطاة.',
      files: [],
      userText: `العنوان: ${email.subject}\nمن: ${email.fromName} <${email.fromEmail}>\n\nنص الإيميل:\n${email.bodyText.slice(0, 2500)}\n\nالمرفقات:\n${fileList || '(لا مرفقات)'}`,
      schema: CLASSIFY_SCHEMA,
      schemaName: 'email_intake',
      temperature: 0.1,
    })

    if (str(parsed.projectName)) draft.name_ar = str(parsed.projectName, 200)
    if (str(parsed.company)) draft.company_ar = str(parsed.company, 200)
    if (str(parsed.engineer)) draft.engineer_name_ar = str(parsed.engineer, 200)
    if (str(parsed.phone)) draft.engineer_phone = str(parsed.phone, 40)

    // Re-bucket by matching the model's classification back to our files by name.
    // Fall back to the heuristic bucket for anything it didn't return.
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
    // AI unavailable/failed — the deterministic draft stands. Convert must never
    // fail because the model did.
  }

  return draft
}
