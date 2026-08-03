// The bilingual "we received your request / preparing your quotation" reply,
// stored ONCE in S3 and reused for every acknowledgment. The team sets it in
// Settings; the inbox reply composer prefills from it (still editable per-send).

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/inbox-ack-template.json'

export interface AckLang { subject: string; body: string }
export interface AckTemplate { ar: AckLang; en: AckLang }

export const DEFAULT_ACK: AckTemplate = {
  ar: {
    subject: 'استلمنا طلبكم — جارٍ تجهيز عرض السعر',
    body: `السلام عليكم ورحمة الله وبركاته،

شكراً لتواصلكم مع مؤسسة كاسب / أبراج العاصمة للرخام والجرانيت.

نفيدكم باستلام طلبكم، وفريقنا يعمل حالياً على دراسة المتطلبات وتجهيز عرض السعر، وسنوافيكم به في أقرب وقت.

لأي استفسار يسعدنا تواصلكم على info@kaaseb.sa
مع خالص التحية،
فريق كاسب`,
  },
  en: {
    subject: 'We received your request — preparing your quotation',
    body: `Dear valued client,

Thank you for contacting KAASEB — Capital Tower for Marble & Granite.

This is to confirm that we have received your request. Our team is reviewing the requirements and preparing your quotation, which we will send to you shortly.

For any inquiry, please reach us at info@kaaseb.sa
Best regards,
The KAASEB team`,
  },
}

export async function getAckTemplate(): Promise<AckTemplate> {
  const t = await readJson<AckTemplate>(KEY, DEFAULT_ACK)
  return {
    ar: { subject: t?.ar?.subject || DEFAULT_ACK.ar.subject, body: t?.ar?.body || DEFAULT_ACK.ar.body },
    en: { subject: t?.en?.subject || DEFAULT_ACK.en.subject, body: t?.en?.body || DEFAULT_ACK.en.body },
  }
}

export async function setAckTemplate(t: AckTemplate): Promise<AckTemplate> {
  const clean: AckTemplate = {
    ar: { subject: String(t?.ar?.subject || '').slice(0, 300), body: String(t?.ar?.body || '').slice(0, 8000) },
    en: { subject: String(t?.en?.subject || '').slice(0, 300), body: String(t?.en?.body || '').slice(0, 8000) },
  }
  await writeJson(KEY, clean)
  return clean
}
