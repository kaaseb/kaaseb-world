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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Plain text → safe HTML twin. Exported so the bulk broadcast sends the exact
// same escaped markup — customer-supplied text can never inject tags.
export function textToHtml(text: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#111827;white-space:pre-wrap">${escapeHtml(text)}</div>`
}

/** Never blast a record's whole contact book — a handful of desks at ONE company
 *  is outreach, more than that starts to look like a mailing list. */
export const MAX_RECIPIENTS = 6

/** Clean a requested recipient list: trim, keep only real addresses, drop
 *  case-insensitive duplicates, cap the count. Returns [] when nothing valid. */
export function normalizeRecipients(input: unknown): string[] {
  const raw: string[] = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === 'string')
    : typeof input === 'string'
      ? input.split(/[;,\n]/)
      : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    const e = r.trim()
    if (!isEmail(e)) continue
    const k = e.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
    if (out.length >= MAX_RECIPIENTS) break
  }
  return out
}

export interface SendOutreachInput {
  /** One or more recipients — all of them go on the same message. */
  to: string[]
  subject: string
  body: string
  profileUrl?: string | null
  profileName?: string | null
  /** Where replies should land — usually the sender's own address. */
  replyTo?: string | null
}

export async function sendOutreachEmail(input: SendOutreachInput): Promise<{ attached: boolean }> {
  const recipients = normalizeRecipients(input.to)
  if (recipients.length === 0) throw new Error('ما فيه عنوان بريد صالح')

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
    // All recipients belong to the SAME record (one company's desks), so a
    // shared To: is expected here and doesn't leak anyone to a stranger.
    to: recipients.join(', '),
    replyTo: input.replyTo || undefined,
    subject: input.subject,
    text: input.body,
    html: textToHtml(input.body),
    attachments,
  })

  return { attached: attachments.length > 0 }
}
