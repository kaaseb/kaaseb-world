// Stage-1 summary: turn a raw customer email into a readable project preview.
//
// This is what the owner reviews BEFORE deciding to promote an email into
// /projects — "وش اسمه، تفاصيل، أي شي مهم". It runs once per NEW email at pull
// time (deduped, so a handful a day), on TEXT ONLY — subject, body, attachment
// filenames — never the 200 files themselves, so it stays cheap.
//
// STRICTLY optional: any failure falls back to a deterministic preview built
// from the fields we already have. A pull must never fail because the model did.

import { getProvider } from '@/lib/ai'
import type { EmailPreview, EmailAttachment } from './store'

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['projectName', 'summary', 'highlights', 'requirements'],
  properties: {
    projectName: { type: 'string', description: 'A clean, short project title in ARABIC. Fall back to the email subject if unclear.' },
    summary: { type: 'string', description: '2-3 sentences in ARABIC: what is this project / what is the customer asking for. ALWAYS write it in Arabic even if the email is English — translate it.' },
    highlights: {
      type: 'array',
      description: 'Up to 5 short ARABIC facts worth seeing at a glance: has a BOQ? a deadline/date? number of buildings/floors? location? budget? scope?',
      items: { type: 'string' },
    },
    requirements: {
      type: 'array',
      description: 'The terms/conditions the CUSTOMER explicitly asks us to address in the quote — each as a short ARABIC phrase. Examples: "سعر الوحدة والإجمالي", "أفضل سعر لأقل وأكبر كمية", "مهلة التسليم", "شروط الدفع", "صلاحية العرض", "الضمان", "المطابقة الفنية للمواصفات". Read them from the body OR any attached RFQ text. Empty array if the email lists none. Do NOT invent.',
      items: { type: 'string' },
    },
  },
} as const

interface RawSummary {
  projectName?: unknown
  summary?: unknown
  highlights?: unknown
  requirements?: unknown
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export interface SummarizeInput {
  subject: string
  fromName: string
  fromEmail: string
  bodyText: string
  attachments: Pick<EmailAttachment, 'name' | 'category'>[]
}

// Deterministic fallback — always valid, no AI.
function fallback(input: SummarizeInput): EmailPreview {
  const hl: string[] = []
  const boq = input.attachments.filter((a) => a.category === 'boq').length
  const dwg = input.attachments.filter((a) => a.category === 'drawing').length
  if (boq > 0) hl.push(`فيه ${boq} جدول كميات`)
  if (dwg > 0) hl.push(`${dwg} رسمة/مخطط`)
  if (input.attachments.length > 0) hl.push(`${input.attachments.length} مرفق`)
  return {
    projectName: input.subject || 'مشروع من البريد',
    summary: input.bodyText ? input.bodyText.slice(0, 300) : 'إيميل من عميل — راجع المرفقات.',
    highlights: hl,
    requirements: [],
  }
}

export async function summarizeEmail(input: SummarizeInput): Promise<EmailPreview> {
  const base = fallback(input)
  // Nothing to reason about beyond what the fallback already shows.
  if (!input.bodyText && input.attachments.length === 0) return base

  try {
    const provider = await getProvider()
    const files = input.attachments.map((a, i) => `${i + 1}. ${a.name} [${a.category}]`).join('\n')
    const parsed = await provider.generateStructured<RawSummary>({
      systemInstruction:
        'أنت مساعد فرز مشاريع لشركة رخام سعودية. من إيميل عميل وقائمة مرفقاته، اكتب ملخصاً سريعاً يساعد صاحب الشركة يقرر هل يحوّله لمشروع، واستخرج الشروط/المتطلبات التي يطلب العميل تغطيتها في العرض. لا تخترع معلومات — لخّص الموجود فقط. اكتب كل المخرجات بالعربي حتى لو كان الإيميل بالإنجليزي (ترجمها).',
      files: [],
      userText: `العنوان: ${input.subject}\nمن: ${input.fromName} <${input.fromEmail}>\n\nنص الإيميل:\n${input.bodyText.slice(0, 3000)}\n\nالمرفقات:\n${files || '(لا مرفقات)'}`,
      schema: SUMMARY_SCHEMA,
      schemaName: 'email_preview',
      temperature: 0.2,
    })

    const projectName = str(parsed.projectName, 200) || base.projectName
    const summary = str(parsed.summary, 600) || base.summary
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((h) => str(h, 120)).filter(Boolean).slice(0, 5)
      : base.highlights
    const requirements = Array.isArray(parsed.requirements)
      ? parsed.requirements.map((r) => str(r, 160)).filter(Boolean).slice(0, 12)
      : base.requirements

    return { projectName, summary, highlights, requirements }
  } catch {
    return base
  }
}
