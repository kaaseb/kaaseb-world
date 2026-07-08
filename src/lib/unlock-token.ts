import { createHmac, timingSafeEqual } from 'crypto'

// HMAC-signed unlock token for the dashboard lock reset flow.
// Format: base64url(payload).base64url(signature) where payload = `${userId}:${expiresAt}`.
// The signature is verified with timing-safe comparison and tokens past their
// expiry are rejected. Without the secret, an attacker cannot forge a token
// for an arbitrary user, which the previous unsigned base64 scheme allowed.

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

function getSecret(): string {
  const secret = process.env.UNLOCK_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error('UNLOCK_TOKEN_SECRET (or SUPABASE_SERVICE_ROLE_KEY) must be set')
  }
  return secret
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)
  return Buffer.from(padded, 'base64')
}

function sign(payload: string): string {
  return b64urlEncode(createHmac('sha256', getSecret()).update(payload).digest())
}

export function createUnlockToken(userId: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const payload = `${userId}:${expiresAt}`
  const sig = sign(payload)
  return `${b64urlEncode(Buffer.from(payload))}.${sig}`
}

export function verifyUnlockToken(token: string): { userId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encodedPayload, providedSig] = parts
  let payload: string
  try {
    payload = b64urlDecode(encodedPayload).toString('utf-8')
  } catch {
    return null
  }

  const expectedSig = sign(payload)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [userId, expiresAtStr] = payload.split(':')
  const expiresAt = parseInt(expiresAtStr, 10)
  if (!userId || !Number.isFinite(expiresAt)) return null
  if (Date.now() > expiresAt) return null

  return { userId }
}
