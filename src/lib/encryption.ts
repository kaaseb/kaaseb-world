import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// Authenticated encryption for the shared-credentials vault. AES-256-GCM with a
// fresh 12-byte IV per record. The auth tag is appended so any tamper of the
// ciphertext is detected at decrypt time.
//
// Key handling:
//   - Provide APP_PASSWORDS_KEY (base64 of 32 bytes, e.g. `openssl rand -base64 32`).
//   - As a fallback we derive a key from SUPABASE_SERVICE_ROLE_KEY so the app
//     boots without extra config, but that's not ideal: rotating the service
//     role key would invalidate every stored password. Set the dedicated key
//     in production.
//
// Envelope format: base64url(iv) "." base64url(authTag) "." base64url(ciphertext)
// Three parts let us recognize a v1 envelope and refuse anything else, which
// makes accidental "decrypt the plaintext column" calls fail loudly.

const VERSION = 'v1'

function getKey(): Buffer {
  const raw = process.env.APP_PASSWORDS_KEY
  if (raw) {
    try {
      const buf = Buffer.from(raw, 'base64')
      if (buf.length === 32) return buf
    } catch { /* fall through */ }
    throw new Error('APP_PASSWORDS_KEY must be 32 bytes encoded as base64')
  }
  // Derived fallback. SHA-256 stretches whatever the service role key is
  // into a fixed 32-byte value. Documented as a fallback only — see header.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!fallback) {
    throw new Error('Set APP_PASSWORDS_KEY (or SUPABASE_SERVICE_ROLE_KEY) to encrypt vault entries')
  }
  return createHash('sha256').update(fallback).digest()
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)
  return Buffer.from(padded, 'base64')
}

export function encryptSecret(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(authTag)}.${b64urlEncode(ciphertext)}`
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid encryption envelope')
  }
  const [, ivStr, tagStr, ctStr] = parts
  const key = getKey()
  const decipher = createDecipheriv('aes-256-gcm', key, b64urlDecode(ivStr))
  decipher.setAuthTag(b64urlDecode(tagStr))
  const plaintext = Buffer.concat([decipher.update(b64urlDecode(ctStr)), decipher.final()])
  return plaintext.toString('utf8')
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`)
}
