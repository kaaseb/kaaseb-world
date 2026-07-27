// The cover message emailed with a quotation PDF — a permanent bilingual body
// (Arabic + English) the team edits once (or regenerates with AI) in Settings.
// The email SUBJECT is the project's keywords field; this is just the body.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/furn-quote-message.json'

export interface QuoteMessage {
  ar: string
  en: string
  updatedAt: string | null
}

export const DEFAULT_AR = `تحية طيبة،

يسعدنا في كاسب — أبراج العاصمة للرخام والجرانيت أن نرفق لكم عرضنا السعري المطلوب (ملف PDF مرفق).

نأمل أن ينال قبولكم، ونحن على أتم الاستعداد لأي استفسار أو تعديل، ولتزويدكم بالعينات والمستندات الفنية عند الحاجة.

مع خالص التقدير،
كاسب — أبراج العاصمة للرخام والجرانيت
info@kaaseb.sa | kaaseb.sa | +966 50 626 8080`

export const DEFAULT_EN = `Dear Sir/Madam,

Please find attached our price quotation as requested (PDF attached), from KAASEB — Capital Tower / Abraj Al-Asima for Marble & Granite.

We hope it meets your requirements and remain at your disposal for any clarification or adjustment, and to provide samples and technical documents on request.

Best regards,
KAASEB — Capital Tower / Abraj Al-Asima for Marble & Granite
info@kaaseb.sa | kaaseb.sa | +966 50 626 8080`

export async function getQuoteMessage(): Promise<QuoteMessage> {
  const s = await readJson<Partial<QuoteMessage> | null>(KEY, null)
  return {
    ar: s?.ar || DEFAULT_AR,
    en: s?.en || DEFAULT_EN,
    updatedAt: s?.updatedAt || null,
  }
}

export async function setQuoteMessage(patch: Partial<Pick<QuoteMessage, 'ar' | 'en'>>): Promise<QuoteMessage> {
  const cur = await getQuoteMessage()
  const next: QuoteMessage = {
    ar: (patch.ar ?? cur.ar).slice(0, 8000) || DEFAULT_AR,
    en: (patch.en ?? cur.en).slice(0, 8000) || DEFAULT_EN,
    updatedAt: new Date().toISOString(),
  }
  await writeJson(KEY, next)
  return next
}
