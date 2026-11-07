// Where outgoing mail actually goes out from — and how it survives the real
// failures of a hosted mailbox.
//
// ROOT FIX for "SMTP env vars missing": the owner already configured Titan
// (info@kaaseb.sa) for the INBOX, and Titan is a full mailbox host — it sends
// over SMTP with the very same login it receives over IMAP. So the send
// transport is built from the Titan account the app already stores (encrypted
// in S3). Configure Titan once → both receiving AND sending work.
//
// RELIABILITY ("sending from Kaaseb World doesn't work"): one transport on one
// port was a single point of failure. Now every send:
//   • goes out on 465 (implicit TLS) with explicit connect/greeting/socket
//     timeouts — a stalled server can no longer hang a request for minutes,
//   • on a CONNECTION-level failure (port blocked by the host's firewall, TLS
//     handshake reset, stale pooled socket, greeting timeout) retries once on
//     587 + STARTTLS — the port most hosts leave open when 465 is filtered,
//   • on a temporary SMTP reply (421/450/451/452) waits briefly and retries,
//   • on an AUTHENTICATION failure stops immediately with a message that says
//     exactly what to fix (wrong password / app password) — retrying a bad
//     password only gets the mailbox locked.
//
// Fallback order for the account itself:
//   1. Titan (enabled + email + password)  → smtp.<titan host>
//   2. SMTP_* env vars (the original path)  → for anyone not on Titan
//   3. neither → a clear Arabic error telling the owner exactly what to set.

import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { ImapFlow } from 'imapflow'
import { randomBytes } from 'node:crypto'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { getTransport as getEnvTransport, getFromAddress as getEnvFrom } from '@/lib/email/client'
import { getTitanSettings, decryptTitanPassword } from '@/lib/integrations/titan'

// Titan's SMTP host mirrors its IMAP host (imap.titan.email → smtp.titan.email).
function titanSmtpHost(imapHost: string): string {
  const h = (imapHost || '').trim().toLowerCase()
  if (h.startsWith('imap.')) return `smtp.${h.slice('imap.'.length)}`
  return 'smtp.titan.email'
}

/** The narrow surface every caller uses. */
export interface MailTransport {
  sendMail: (msg: nodemailer.SendMailOptions) => Promise<SentInfo>
  verify: () => Promise<true>
}

export interface ResolvedMailer {
  transport: MailTransport
  from: string
  /** Sensible Reply-To when the caller doesn't set one (the sending mailbox). */
  replyToDefault: string | null
}

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 }

type SmtpError = Error & { code?: string; responseCode?: number; command?: string }

/** A failure of the CONNECTION (worth another port), not of the message. */
export function isConnectionError(e: unknown): boolean {
  const err = e as SmtpError
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ENOTFOUND', 'EPROTOCOL'].includes(err?.code || '')) return true
  return /greeting never received|connection (closed|timeout)|socket (hang up|closed)|timed? ?out|tls|ssl|wrong version number/i.test(err?.message || '')
}
/** A temporary SMTP reply — the same server may accept it a moment later. */
export function isTransientReply(e: unknown): boolean {
  const c = (e as SmtpError)?.responseCode
  return c === 421 || c === 450 || c === 451 || c === 452
}
export function isAuthError(e: unknown): boolean {
  const err = e as SmtpError
  return err?.code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 534 || /authentication|auth.*fail|invalid login|username and password/i.test(err?.message || '')
}

/** One human sentence for the UI, the raw reason kept for the log. */
export function explainMailError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (isAuthError(e)) return `رفض خادم البريد تسجيل الدخول — كلمة مرور بريد Titan غير صحيحة أو تغيّرت. حدّثها من الإعدادات ← تكامل Titan. (${raw})`
  if (isConnectionError(e)) return `تعذّر الاتصال بخادم البريد على المنفذين 465 و587 — الغالب أن الخادم يحجب منافذ البريد الصادر؛ يُفتح من لوحة الاستضافة. (${raw})`
  const code = (e as SmtpError)?.responseCode
  if (code === 550 || code === 553 || code === 554) return `رُفضت الرسالة من خادم البريد (عنوان المستلم غير صحيح أو الرسالة مرفوضة). (${raw})`
  if (code === 552) return `الرسالة أكبر من الحد المسموح لدى خادم البريد — صغّر المرفقات. (${raw})`
  return raw
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Transports cached per settings key, so any change (new password, new email)
// rebuilds them instead of sending with stale credentials.
let cached: { key: string; primary: nodemailer.Transporter; fallback: nodemailer.Transporter } | null = null

function robust(primary: nodemailer.Transporter, fallback: nodemailer.Transporter | null): MailTransport {
  async function attempt<T>(fn: (t: nodemailer.Transporter) => Promise<T>): Promise<T> {
    try {
      return await fn(primary)
    } catch (e) {
      if (isAuthError(e)) throw e
      if (isTransientReply(e)) { await sleep(2500); return fn(primary) }
      if (fallback && isConnectionError(e)) {
        try {
          return await fn(fallback)
        } catch (e2) {
          // Report the more informative of the two failures.
          throw isAuthError(e2) || !isConnectionError(e2) ? e2 : e
        }
      }
      throw e
    }
  }
  return {
    sendMail: (msg) => attempt((t) => t.sendMail(msg) as Promise<SMTPTransport.SentMessageInfo>),
    verify: () => attempt((t) => t.verify()),
  }
}

// ── a copy in the mailbox's «Sent» folder ───────────────────────────────────
// SMTP only DELIVERS a message; it never files a copy. Without this, everything
// the platform sent (campaign, replies, quotations) was invisible in Titan's
// Sent folder — "nothing was sent" — even when it had been delivered. Every
// Titan send now appends the exact same message (same Message-ID) to Sent.

/** The Sent folder: the server's \Sent flag first, then the usual names. */
export function pickSentFolder(boxes: Array<{ path: string; name: string; specialUse?: string }>): string | null {
  const flagged = boxes.find((b) => b.specialUse === '\\Sent')
  if (flagged) return flagged.path
  const named = boxes.find((b) => /^(sent|sent items|sent messages|sent mail|المرسل|البريد المرسل)$/i.test(b.name))
  return named ? named.path : null
}

async function appendToSent(imap: { host: string; port: number; user: string; pass: string }, raw: Buffer): Promise<boolean> {
  const client = new ImapFlow({
    host: imap.host, port: imap.port, secure: true,
    auth: { user: imap.user, pass: imap.pass }, logger: false,
    greetingTimeout: 15_000, socketTimeout: 30_000,
  })
  try {
    await client.connect()
    const folder = pickSentFolder(await client.list())
    if (!folder) { console.error('[mail] no Sent folder found — copy not saved'); return false }
    return !!(await client.append(folder, raw, ['\\Seen'], new Date()))
  } finally {
    await client.logout().catch(() => {})
  }
}

export interface SentInfo extends SMTPTransport.SentMessageInfo {
  /** A copy was filed in the mailbox's Sent folder. */
  savedToSent?: boolean
}

function withSentCopy(t: MailTransport, imap: { host: string; port: number; user: string; pass: string }): MailTransport {
  const domain = imap.user.split('@')[1] || 'kaaseb.sa'
  return {
    verify: t.verify,
    sendMail: async (msg) => {
      // One fixed Message-ID + Date for the delivered message AND its Sent copy.
      const m: nodemailer.SendMailOptions = { ...msg, messageId: msg.messageId || `<${randomBytes(12).toString('hex')}@${domain}>`, date: msg.date || new Date() }
      const info: SentInfo = await t.sendMail(m)
      // Delivery already succeeded: a failed copy must never turn it into an error.
      try {
        const raw = await new MailComposer(m).compile().build()
        info.savedToSent = await Promise.race([
          appendToSent(imap, raw),
          new Promise<boolean>((r) => setTimeout(() => r(false), 25_000)),
        ])
      } catch (e) {
        console.error('[mail] saving the Sent copy failed:', e instanceof Error ? e.message : e)
        info.savedToSent = false
      }
      return info
    },
  }
}

export async function resolveMailer(): Promise<ResolvedMailer> {
  const titan = await getTitanSettings()
  const pass = titan.enabled && titan.email ? decryptTitanPassword(titan) : null

  if (titan.enabled && titan.email && pass) {
    const host = titanSmtpHost(titan.host)
    const key = `${host}|${titan.email}|${titan.updatedAt}`
    if (!cached || cached.key !== key) {
      const auth = { user: titan.email, pass }
      cached = {
        key,
        // Not pooled: a pooled socket the server closed while idle fails the
        // NEXT send — the most common "it worked yesterday" mail failure.
        primary: nodemailer.createTransport({ host, port: 465, secure: true, auth, ...TIMEOUTS }),
        fallback: nodemailer.createTransport({ host, port: 587, secure: false, requireTLS: true, auth, ...TIMEOUTS }),
      }
    }
    return {
      transport: withSentCopy(robust(cached.primary, cached.fallback), { host: titan.host, port: titan.port, user: titan.email, pass }),
      // From MUST be the authenticated mailbox or Titan rejects the send.
      from: `"KAASEB" <${titan.email}>`,
      replyToDefault: titan.email,
    }
  }

  // No Titan — try the classic SMTP_* env path.
  let env: nodemailer.Transporter
  try {
    env = getEnvTransport()
  } catch {
    throw new Error(
      'الإرسال غير مهيّأ. فعّل تكامل Titan في الإعدادات (نفس بريد صندوق الوارد info@kaaseb.sa) — منه يُرسَل تلقائياً. أو اضبط متغيرات SMTP على الخادم.',
    )
  }
  return { transport: robust(env, null), from: getEnvFrom(), replyToDefault: null }
}
