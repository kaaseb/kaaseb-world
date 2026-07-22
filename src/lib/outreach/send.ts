// Sending an outreach mail. Reuses the app's existing SMTP transport
// (lib/email/client) — no new dependency, no second credential store.
//
// SAFETY, because this leaves the building and cannot be recalled:
//   • the recipient must look like a real address (no blind sends);
//   • the profile attachment is fetched through fetchAppOwned (SSRF-guarded,
//     our own S3/CDN only) and capped, so a bad URL can't be weaponised;
//   • the body is sent as plain text AND a minimally-escaped HTML twin, so no
//     customer-supplied string can inject markup into the mail we send.

import { getTransport, getFromAddress } from '@/lib/email/client'
import { fetchAppOwned } from '@/lib/s3'

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // a company profile is a few MB

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v || '').trim())
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToHtml(text: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#111827;white-space:pre-wrap">${escapeHtml(text)}</div>`
}

export interface SendOutreachInput {
  to: string
  subject: string
  body: string
  profileUrl?: string | null
  profileName?: string | null
  /** Where replies should land — usually the sender's own address. */
  replyTo?: string | null
}

export async function sendOutreachEmail(input: SendOutreachInput): Promise<{ attached: boolean }> {
  if (!isEmail(input.to)) throw new Error('عنوان البريد غير صالح')

  const attachments: Array<{ filename: string; content: Buffer }> = []
  if (input.profileUrl) {
    try {
      const res = await fetchAppOwned(input.profileUrl)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength > 0 && buf.byteLength <= MAX_ATTACHMENT_BYTES) {
          attachments.push({
            filename: input.profileName || 'Company-Profile.pdf',
            content: buf,
          })
        }
      }
    } catch {
      // A missing profile must not block the message — we report `attached`
      // back so the UI can warn instead of silently sending a bare email.
    }
  }

  await getTransport().sendMail({
    from: getFromAddress(),
    to: input.to.trim(),
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.body,
    html: textToHtml(input.body),
    attachments,
  })

  return { attached: attachments.length > 0 }
}
