// The Titan IMAP pull.
//
// Connects to imap.titan.email over TLS, reads the most recent messages, and
// mirrors any it hasn't seen before into the S3 inbox store — attachments go to
// S3, metadata to app-data/inbox.json. Deterministic and bounded: no AI here
// (classification/extraction happens later, at convert time), so a pull costs
// nothing but bandwidth.
//
// Runs as a background job (fire-and-forget from the manual button / the daily
// cron). beginPull() refuses to stack a second run on a live one.

import { createHash } from 'crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { uploadBufferToS3, safeNameStem, safeExtension } from '@/lib/s3'
import { getTitanSettings, decryptTitanPassword } from '@/lib/integrations/titan'
import {
  beginPull, finishPull, addEmails, knownMessageIds,
  type NewEmail, type EmailAttachment, type PullTrigger,
} from './store'

// Bound each run so it always finishes well inside the 15-min stale window.
// Dedup means anything missed is caught on the next pull.
const MAX_FETCH = 25
const MAX_ATTACHMENTS_PER_EMAIL = 300
const MAX_ATTACHMENT_BYTES = 60 * 1024 * 1024 // 60 MB — a huge single drawing
const BODY_PREVIEW_CHARS = 4000

const log = (msg: string) => console.log(`[صندوق] ${msg}`)

// Heuristic file bucket — a free, deterministic first guess. The team re-files
// in the Furn form if it's wrong; convert-time AI can also refine it.
function guessCategory(name: string): EmailAttachment['category'] {
  const n = name.toLowerCase()
  if (/\.(xlsx|xls|csv)$/.test(n) || /\b(boq|bill of quantit|جدول الكميات|كميات)\b/.test(n)) return 'boq'
  if (/\.(dwg|dxf|rvt)$/.test(n) || /\b(drawing|plan|elevation|section|layout|رسم|مخطط|مساقط|واجهة)\b/.test(n) || /\ba-?\d{2,}/.test(n)) return 'drawing'
  if (/\b(spec|specification|datasheet|مواصفات)\b/.test(n)) return 'spec'
  return 'other'
}

function idHash(messageId: string): string {
  return createHash('sha1').update(messageId).digest('hex').slice(0, 16)
}

export interface PullResult {
  ok: boolean
  fetched: number
  added: number
  error: string | null
  skipped?: boolean
}

export async function runPull(opts: { trigger: PullTrigger; by?: string | null }): Promise<PullResult> {
  const run = await beginPull(opts.trigger, opts.by ?? null)
  if (!run) return { ok: false, fetched: 0, added: 0, error: null, skipped: true }

  let client: ImapFlow | null = null
  try {
    const titan = await getTitanSettings()
    if (!titan.enabled) throw new Error('تكامل Titan غير مفعّل — فعّله في الإعدادات.')
    if (!titan.email) throw new Error('إيميل Titan غير مضبوط.')
    const pass = decryptTitanPassword(titan)
    if (!pass) throw new Error('كلمة مرور Titan غير مضبوطة.')

    client = new ImapFlow({
      host: titan.host,
      port: titan.port,
      secure: true,
      auth: { user: titan.email, pass },
      logger: false,
      // Titan can be slow to greet; don't hang a background job forever.
      greetingTimeout: 20_000,
      socketTimeout: 120_000,
    })

    await client.connect()
    log(`connected as ${titan.email}`)

    const known = await knownMessageIds()
    const emails: NewEmail[] = []
    let fetched = 0

    const lock = await client.getMailboxLock(titan.folder || 'INBOX')
    try {
      const total = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox.exists : 0
      if (total > 0) {
        const from = Math.max(1, total - MAX_FETCH + 1)
        // Newest last in a sequence range; we sort by date in the store anyway.
        for await (const msg of client.fetch(`${from}:*`, { source: true })) {
          if (!msg.source) continue
          fetched++
          let parsed
          try {
            parsed = await simpleParser(msg.source)
          } catch {
            continue // a single unparseable message must not kill the run
          }

          // Dedup key: the RFC Message-ID, falling back to a hash of the raw
          // bytes so a message without one still gets a stable identity.
          const messageId = (parsed.messageId || '').trim() || `sha:${createHash('sha1').update(msg.source).digest('hex')}`
          if (known.has(messageId) || emails.some((e) => e.id === messageId)) continue

          const hid = idHash(messageId)
          const atts: EmailAttachment[] = []
          for (const att of (parsed.attachments || []).slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
            const buf = att.content as Buffer
            if (!buf || !Buffer.isBuffer(buf) || buf.byteLength === 0) continue
            if (buf.byteLength > MAX_ATTACHMENT_BYTES) continue
            const rawName = att.filename || `attachment-${atts.length + 1}`
            const ext = safeExtension(rawName)
            const stem = safeNameStem(rawName)
            const key = `inbox/${hid}/${stem}-${atts.length + 1}.${ext}`
            try {
              const up = await uploadBufferToS3({
                buffer: buf,
                key,
                contentType: att.contentType || 'application/octet-stream',
              })
              atts.push({
                name: rawName,
                url: up.url,
                key: up.key,
                bytes: up.bytes,
                contentType: att.contentType || 'application/octet-stream',
                category: guessCategory(rawName),
              })
            } catch {
              /* one attachment upload failing shouldn't lose the whole email */
            }
          }

          emails.push({
            id: messageId,
            subject: (parsed.subject || '').trim().slice(0, 300) || '(بلا عنوان)',
            fromName: (parsed.from?.value?.[0]?.name || '').trim().slice(0, 200),
            fromEmail: (parsed.from?.value?.[0]?.address || '').trim().slice(0, 200),
            date: (parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime())
              ? parsed.date
              : new Date()).toISOString(),
            bodyText: (parsed.text || '').trim().slice(0, BODY_PREVIEW_CHARS),
            attachments: atts,
          })
        }
      }
    } finally {
      lock.release()
    }

    const added = await addEmails(emails)
    await finishPull({ status: 'done', fetched, added, error: null })
    log(`pull done — fetched=${fetched} added=${added}`)
    return { ok: true, fetched, added, error: null }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل سحب البريد'
    await finishPull({ status: 'failed', error })
    log(`pull FAILED — ${error}`)
    return { ok: false, fetched: 0, added: 0, error }
  } finally {
    if (client) {
      try { await client.logout() } catch { /* already gone */ }
    }
  }
}
