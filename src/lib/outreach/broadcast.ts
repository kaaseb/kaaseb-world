// Bulk "about KAASEB" broadcast — one general message to a pasted/uploaded list.
//
// Distinct from the per-record outreach: no {{placeholders}}, no status change,
// just a company introduction to many addresses at once.
//
// SAFETY (this is the highest-blast-radius action in the app):
//   • recipients go in BCC, never To/Cc — nobody on the list sees anyone else's
//     address (a Reply-All / leaked-list incident is how these go wrong);
//   • sent in batches so one provider hiccup doesn't lose the whole run and no
//     single message carries an implausible recipient count;
//   • the list is validated + de-duped (case-insensitive) and hard-capped;
//   • same escaped-HTML twin as the single send, so no markup injection.

import { getTransport, getFromAddress } from '@/lib/email/client'
import { fetchAppOwned } from '@/lib/s3'
import { isEmail, textToHtml } from './send'

export const BROADCAST_MAX = 1000 // a hard ceiling on one run
const BCC_BATCH = 40 // recipients per message — comfortably under provider caps
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

/** Split a free-form paste/upload into clean, unique, valid addresses. Returns
 *  the valid set (capped) plus how many were dropped as invalid/duplicate. */
export function parseEmailList(raw: string): { valid: string[]; invalid: number; duplicates: number } {
  const tokens = (raw || '').split(/[\s,;<>()"'\[\]]+/).map((t) => t.trim()).filter(Boolean)
  const seen = new Set<string>()
  const valid: string[] = []
  let invalid = 0
  let duplicates = 0
  for (const t of tokens) {
    if (!isEmail(t)) { invalid++; continue }
    const k = t.toLowerCase()
    if (seen.has(k)) { duplicates++; continue }
    seen.add(k)
    if (valid.length < BROADCAST_MAX) valid.push(t)
  }
  return { valid, invalid, duplicates }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface BroadcastInput {
  subject: string
  body: string
  emails: string[]
  attachProfile: boolean
  profileUrl?: string | null
  profileName?: string | null
  replyTo?: string | null
}

export interface BroadcastResult {
  sent: number
  failed: number
  batches: number
  attached: boolean
}

export async function sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
  const recipients = input.emails.filter((e) => isEmail(e)).slice(0, BROADCAST_MAX)
  if (recipients.length === 0) throw new Error('ما فيه عناوين صالحة')

  const attachments: Array<{ filename: string; content: Buffer }> = []
  if (input.attachProfile && input.profileUrl) {
    try {
      const res = await fetchAppOwned(input.profileUrl)
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength > 0 && buf.byteLength <= MAX_ATTACHMENT_BYTES) {
          attachments.push({ filename: input.profileName || 'KAASEB-Company-Profile.pdf', content: buf })
        }
      }
    } catch { /* attachment is optional — a broadcast without it still sends */ }
  }

  const from = getFromAddress()
  const html = textToHtml(input.body)
  const batches = chunk(recipients, BCC_BATCH)
  let sent = 0
  let failed = 0

  for (const batch of batches) {
    try {
      await getTransport().sendMail({
        from,
        // A valid To keeps some servers from binning it as spam; the real
        // recipients are BCC so they never see each other.
        to: from,
        bcc: batch.join(', '),
        replyTo: input.replyTo || undefined,
        subject: input.subject,
        text: input.body,
        html,
        attachments,
      })
      sent += batch.length
    } catch {
      failed += batch.length
    }
  }

  return { sent, failed, batches: batches.length, attached: attachments.length > 0 }
}
