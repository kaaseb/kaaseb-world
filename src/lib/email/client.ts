import nodemailer from 'nodemailer'

// Singleton SMTP transport. Built lazily so a missing env var fails on first
// send (with a clear error) rather than at import time.
//
// Required env vars (set in `.env.local` for dev and your hosting provider
// for prod):
//   SMTP_HOST       — e.g. smtp.gmail.com
//   SMTP_PORT       — e.g. 465 (SSL) or 587 (STARTTLS)
//   SMTP_SECURE     — "true" for port 465, "false" for 587
//   SMTP_USER       — full sender address (auth username)
//   SMTP_PASS       — Gmail App Password (16 chars, no spaces)
//   SMTP_FROM_NAME  — display name shown to recipients

let cached: nodemailer.Transporter | null = null

export function getTransport(): nodemailer.Transporter {
  if (cached) return cached
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 465)
  const secure = (process.env.SMTP_SECURE ?? 'true') !== 'false'
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    throw new Error('SMTP env vars missing (SMTP_HOST, SMTP_USER, SMTP_PASS)')
  }

  cached = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    // Gmail occasionally throttles parallel connections; cap at 5 so a burst
    // of post-creation notifications doesn't get the account flagged.
    pool: true, maxConnections: 5,
  })
  return cached
}

export function getFromAddress(): string {
  const user = process.env.SMTP_USER ?? 'noreply@example.com'
  const name = process.env.SMTP_FROM_NAME ?? 'Kaaseb'
  return `"${name}" <${user}>`
}
