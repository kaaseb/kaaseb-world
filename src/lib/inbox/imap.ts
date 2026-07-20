// The Titan IMAP intake — split into two tiers so it scales to a full mailbox.
//
//   • runList()      → LIST sync. Reads only the ENVELOPE (subject/from/date +
//     an attachment count from the body structure) for the newest LIST_MAX
//     messages. No bytes pulled, no attachments downloaded, no AI. Cheap enough
//     to sync hundreds of messages in one pass, so the owner sees the whole
//     mailbox with a live count — not an arbitrary 25.
//   • hydrateEmail() → per-message FETCH. Only when the owner picks a message do
//     we download its source, push the 200 attachments to S3, and run the stage-1
//     AI summary. The expensive work happens once, on demand, for the messages
//     that matter — never eagerly for the whole inbox.
//
// Both run as background jobs (fire-and-forget). beginPull() refuses to stack a
// second LIST sync on a live one.

import { createHash } from 'crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { uploadBufferToS3, safeNameStem, safeExtension } from '@/lib/s3'
import { getTitanSettings, decryptTitanPassword } from '@/lib/integrations/titan'
import {
  beginPull, finishPull, upsertListed, getEmail, applyHydration,
  type ListedEmail, type EmailAttachment, type InboxEmail, type PullTrigger,
} from './store'
import { summarizeEmail } from './summarize'

// How many of the newest messages a LIST sync mirrors. Envelopes are tiny, so
// this is 20× the old whole-message cap and still costs almost nothing.
const LIST_MAX = 500
const MAX_ATTACHMENTS_PER_EMAIL = 300
const MAX_ATTACHMENT_BYTES = 60 * 1024 * 1024 // 60 MB — a huge single drawing
// Whole-message ceiling, checked from the SIZE header (captured at list time)
// BEFORE any bytes are pulled. A customer mailbox is externally reachable, so a
// crafted multi-GB message must be rejected without ever being buffered. 120 MB
// comfortably holds a real 200-drawing project.
const MAX_MESSAGE_BYTES = 120 * 1024 * 1024
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

// Count attachment leaves in an IMAP body structure without downloading anything.
// A leaf is an attachment if it's dispositioned 'attachment', or it carries a
// filename and isn't explicitly inline. Good enough for the "N attachments"
// hint; the exact set is resolved by mailparser at hydrate time.
interface BodyNode {
  disposition?: string
  dispositionParameters?: Record<string, unknown> | null
  parameters?: Record<string, unknown> | null
  childNodes?: BodyNode[]
}
function countAttachments(node: BodyNode | null | undefined): number {
  if (!node) return 0
  if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
    return node.childNodes.reduce((n, c) => n + countAttachments(c), 0)
  }
  const disp = (node.disposition || '').toLowerCase()
  const filename = node.dispositionParameters?.filename || node.parameters?.name
  if (disp === 'attachment') return 1
  if (filename && disp !== 'inline') return 1
  return 0
}

async function connectTitan(): Promise<{ client: ImapFlow; folder: string }> {
  const titan = await getTitanSettings()
  if (!titan.enabled) throw new Error('تكامل Titan غير مفعّل — فعّله في الإعدادات.')
  if (!titan.email) throw new Error('إيميل Titan غير مضبوط.')
  const pass = decryptTitanPassword(titan)
  if (!pass) throw new Error('كلمة مرور Titan غير مضبوطة.')

  const client = new ImapFlow({
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
  return { client, folder: titan.folder || 'INBOX' }
}

export interface PullResult {
  ok: boolean
  fetched: number
  added: number
  error: string | null
  skipped?: boolean
}

// ── Tier 1: LIST sync ────────────────────────────────────────────────────────
export async function runList(opts: { trigger: PullTrigger; by?: string | null }): Promise<PullResult> {
  const run = await beginPull(opts.trigger, opts.by ?? null)
  if (!run) return { ok: false, fetched: 0, added: 0, error: null, skipped: true }

  let client: ImapFlow | null = null
  try {
    const conn = await connectTitan()
    client = conn.client
    log(`connected (list)`)

    const listed: ListedEmail[] = []
    let fetched = 0

    const lock = await client.getMailboxLock(conn.folder)
    try {
      const box = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox : null
      const total = box ? box.exists : 0
      const uidValidity = box ? Number(box.uidValidity) : 0
      if (total > 0) {
        const from = Math.max(1, total - LIST_MAX + 1)
        // Envelope + size + structure only. No `source`, so no message body is
        // ever pulled here — this is what keeps a full-mailbox list cheap.
        for await (const meta of client.fetch(
          `${from}:*`,
          { uid: true, envelope: true, size: true, bodyStructure: true, internalDate: true },
        )) {
          fetched++
          const env = meta.envelope
          const messageId = (env?.messageId || '').trim() || `uidkey:${uidValidity}:${meta.uid}`
          const envDate = env?.date instanceof Date && !Number.isNaN(env.date.getTime()) ? env.date : null
          const intDate = meta.internalDate instanceof Date && !Number.isNaN(meta.internalDate.getTime()) ? meta.internalDate : null
          listed.push({
            id: messageId,
            subject: (env?.subject || '').trim().slice(0, 300) || '(بلا عنوان)',
            fromName: (env?.from?.[0]?.name || '').trim().slice(0, 200),
            fromEmail: (env?.from?.[0]?.address || '').trim().slice(0, 200),
            date: (envDate || intDate || new Date()).toISOString(),
            attachmentCount: countAttachments(meta.bodyStructure as unknown as BodyNode),
            size: meta.size || 0,
            uid: meta.uid,
            uidValidity,
            folder: conn.folder,
            inReplyTo: (env?.inReplyTo || '').trim() || null,
          })
        }
      }
    } finally {
      lock.release()
    }

    const added = await upsertListed(listed)
    await finishPull({ status: 'done', fetched, added, error: null })
    log(`list done — fetched=${fetched} added=${added}`)
    return { ok: true, fetched, added, error: null }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل تحديث القائمة'
    await finishPull({ status: 'failed', error })
    log(`list FAILED — ${error}`)
    return { ok: false, fetched: 0, added: 0, error }
  } finally {
    if (client) {
      try { await client.logout() } catch { /* already gone */ }
    }
  }
}

// ── Tier 2: per-message hydrate ──────────────────────────────────────────────
export interface HydrateResult {
  ok: boolean
  email?: InboxEmail
  error?: string | null
}

export async function hydrateEmail(id: string): Promise<HydrateResult> {
  const stored = await getEmail(id)
  if (!stored) return { ok: false, error: 'الرسالة غير موجودة في القائمة.' }
  if (stored.hydrated) return { ok: true, email: stored }
  if (stored.size && stored.size > MAX_MESSAGE_BYTES) {
    return { ok: false, error: `الرسالة كبيرة جداً (${Math.round(stored.size / 1024 / 1024)}MB) — لا يمكن إحضارها.` }
  }

  let client: ImapFlow | null = null
  try {
    const conn = await connectTitan()
    client = conn.client

    let source: Buffer | null = null
    const lock = await client.getMailboxLock(stored.folder || conn.folder)
    try {
      const box = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox : null
      const currentValidity = box ? Number(box.uidValidity) : null

      // Preferred path: fetch by the stored UID while the mailbox hasn't reset.
      if (stored.uid && stored.uidValidity && currentValidity === stored.uidValidity) {
        const msg = await client.fetchOne(String(stored.uid), { source: true }, { uid: true })
        if (msg && msg.source) source = msg.source as Buffer
      }

      // Fallback: the UID went stale (a mailbox reset bumps UIDVALIDITY) — locate
      // the message again by its RFC Message-ID. Best-effort: some servers reject
      // header search, in which case there's nothing more to try.
      if (!source && stored.id.includes('@')) {
        try {
          const mid = stored.id.replace(/^</, '').replace(/>$/, '')
          const uids = await client.search({ header: { 'message-id': mid } }, { uid: true })
          if (Array.isArray(uids) && uids.length > 0) {
            const msg = await client.fetchOne(String(uids[uids.length - 1]), { source: true }, { uid: true })
            if (msg && msg.source) source = msg.source as Buffer
          }
        } catch { /* header search unsupported — give up gracefully */ }
      }
    } finally {
      lock.release()
    }

    if (!source) return { ok: false, error: 'تعذّر إيجاد الرسالة على الخادم — حدّث القائمة وأعد المحاولة.' }

    let parsed
    try {
      parsed = await simpleParser(source)
    } catch {
      return { ok: false, error: 'تعذّر قراءة الرسالة.' }
    }

    const hid = idHash(stored.id)
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

    const bodyText = (parsed.text || '').trim().slice(0, BODY_PREVIEW_CHARS)
    const preview = await summarizeEmail({
      subject: stored.subject,
      fromName: stored.fromName,
      fromEmail: stored.fromEmail,
      bodyText,
      attachments: atts.map((a) => ({ name: a.name, category: a.category })),
    })

    const email = await applyHydration(stored.id, { bodyText, attachments: atts, preview })
    if (!email) return { ok: false, error: 'تعذّر حفظ الرسالة.' }
    log(`hydrated ${stored.id} — ${atts.length} attachments`)
    return { ok: true, email }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'فشل إحضار الرسالة.'
    log(`hydrate FAILED — ${error}`)
    return { ok: false, error }
  } finally {
    if (client) {
      try { await client.logout() } catch { /* already gone */ }
    }
  }
}
