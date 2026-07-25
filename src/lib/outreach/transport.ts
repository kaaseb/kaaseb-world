// Where outreach mail actually goes out from.
//
// ROOT FIX for "SMTP env vars missing": the owner already configured Titan
// (info@kaaseb.sa) for the INBOX, and Titan is a full mailbox host — it sends
// over SMTP with the very same login it receives over IMAP. So instead of asking
// for a second, separate SMTP_* credential set, we build the send transport from
// the Titan account the app already stores (encrypted in S3). Configure Titan
// once → both receiving AND sending work, no env vars, no redeploy.
//
// Fallback order:
//   1. Titan (enabled + email + password)  → smtp.titan.email:465, From = that box
//   2. SMTP_* env vars (the original path)  → for anyone not on Titan
//   3. neither → a clear Arabic error telling the owner exactly what to set.

import nodemailer from 'nodemailer'
import { getTransport as getEnvTransport, getFromAddress as getEnvFrom } from '@/lib/email/client'
import { getTitanSettings, decryptTitanPassword } from '@/lib/integrations/titan'

// Titan's SMTP host mirrors its IMAP host (imap.titan.email → smtp.titan.email).
function titanSmtpHost(imapHost: string): string {
  const h = (imapHost || '').trim().toLowerCase()
  if (h.startsWith('imap.')) return `smtp.${h.slice('imap.'.length)}`
  return 'smtp.titan.email'
}

export interface ResolvedMailer {
  transport: nodemailer.Transporter
  from: string
  /** Sensible Reply-To when the caller doesn't set one (the sending mailbox). */
  replyToDefault: string | null
}

// Cache the Titan transport, keyed so ANY settings change (new password, new
// email) rebuilds it instead of sending with stale credentials.
let cached: { key: string; transport: nodemailer.Transporter } | null = null

export async function resolveMailer(): Promise<ResolvedMailer> {
  const titan = await getTitanSettings()
  const pass = titan.enabled && titan.email ? decryptTitanPassword(titan) : null

  if (titan.enabled && titan.email && pass) {
    const host = titanSmtpHost(titan.host)
    const key = `${host}|${titan.email}|${titan.updatedAt}`
    if (!cached || cached.key !== key) {
      cached = {
        key,
        transport: nodemailer.createTransport({
          host,
          port: 465,
          secure: true,
          auth: { user: titan.email, pass },
          pool: true,
          maxConnections: 3,
        }),
      }
    }
    return {
      transport: cached.transport,
      // From MUST be the authenticated mailbox or Titan rejects the send.
      from: `"KAASEB" <${titan.email}>`,
      replyToDefault: titan.email,
    }
  }

  // No Titan — try the classic SMTP_* env path.
  try {
    return { transport: getEnvTransport(), from: getEnvFrom(), replyToDefault: null }
  } catch {
    throw new Error(
      'الإرسال غير مهيّأ. فعّل تكامل Titan في الإعدادات (نفس بريد صندوق الوارد info@kaaseb.sa) — منه يُرسَل تلقائياً. أو اضبط متغيرات SMTP على الخادم.',
    )
  }
}
