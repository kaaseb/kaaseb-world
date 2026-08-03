// Send a reply to an inbox message through the SAME Titan account the inbox
// receives on (resolveMailer). Sets In-Reply-To / References so the reply threads
// under the original in the customer's mail client.

import { resolveMailer } from '@/lib/outreach/transport'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function toHtml(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>')
}

// A stored id is the RFC Message-ID for a real message, or a "uidkey:…" fallback
// for one that had none. Only the former is a valid threading header.
export function messageIdHeader(id: string): string | null {
  if (!id || id.startsWith('uidkey:') || !id.includes('@')) return null
  return id.startsWith('<') ? id : `<${id}>`
}

export interface SendReplyInput {
  to: string
  subject: string
  text: string
  inReplyTo?: string | null
  references?: string | null
  replyTo?: string | null
  dir?: 'rtl' | 'ltr'
}

export async function sendReply(input: SendReplyInput): Promise<{ ok: true }> {
  const mailer = await resolveMailer()
  const dir = input.dir || 'rtl'
  const html = `<div dir="${dir}" style="font-family:Tajawal,Arial,sans-serif;font-size:14px;line-height:1.8;color:#111827;white-space:normal">${toHtml(input.text)}</div>`
  await mailer.transport.sendMail({
    from: mailer.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html,
    replyTo: input.replyTo || mailer.replyToDefault || undefined,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references || input.inReplyTo || undefined,
  })
  return { ok: true }
}
