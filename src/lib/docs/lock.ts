// Important-documents secret gate — an OPTIONAL PIN on top of the
// `page.important_docs` permission.
//
// Unlike the inbox lock (always on with a default PIN), this gate is OFF until
// the super admin sets a PIN. Once set, even authorised users must enter it
// before any document is shown; the super admin can clear it to disable again.
// State is tiny and lives in S3 (no DB columns) like everything else here.
//
// Security shape mirrors the inbox lock:
//   • The PIN is never stored — only appHmac("docs-pin:"+pin), a one-way keyed
//     hash. A leaked S3 blob reveals nothing without the server key.
//   • Unlock is a cookie whose value is appHmac("docs-unlock:"+pinHash). Because
//     it's derived from the CURRENT hash, changing/clearing the PIN instantly
//     invalidates every device — no session list to clear.

import { timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { readJson, writeJson } from '@/lib/s3'
import { appHmac } from '@/lib/encryption'

const KEY = 'app-data/docs-lock.json'
export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 64

export const DOCS_COOKIE = 'kaaseb_docs_unlock'
export const DOCS_COOKIE_MAXAGE = 60 * 60 * 12 // 12 hours per device

interface LockState { pinHash: string }

function hashPin(pin: string): string {
  return appHmac(`docs-pin:${pin.trim()}`)
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

/** The stored PIN hash, or '' when no PIN is set (gate disabled). */
async function getPinHash(): Promise<string> {
  const s = await readJson<LockState | null>(KEY, null)
  return s?.pinHash || ''
}

/** Is a PIN configured at all? When false the page is open (no gate). */
export async function docsLockConfigured(): Promise<boolean> {
  return (await getPinHash()) !== ''
}

export async function verifyDocsPin(pin: string): Promise<boolean> {
  if (!pin) return false
  const hash = await getPinHash()
  if (!hash) return false
  return safeEqual(hashPin(pin), hash)
}

/** Set/replace the PIN (super-admin only, enforced at the route). Returns the
 *  new unlock token so the caller can refresh its own cookie and stay in. */
export async function setDocsPin(pin: string): Promise<{ ok: boolean; error?: string; unlockToken?: string }> {
  const clean = (pin || '').trim()
  if (clean.length < MIN_PIN_LENGTH) return { ok: false, error: `الرقم قصير — ${MIN_PIN_LENGTH} خانات على الأقل.` }
  if (clean.length > MAX_PIN_LENGTH) return { ok: false, error: 'الرقم طويل جداً.' }
  const pinHash = hashPin(clean)
  await writeJson(KEY, { pinHash })
  return { ok: true, unlockToken: unlockTokenFor(pinHash) }
}

/** Remove the PIN — the page becomes open for everyone with the permission. */
export async function clearDocsPin(): Promise<void> {
  await writeJson(KEY, { pinHash: '' })
}

function unlockTokenFor(pinHash: string): string {
  return appHmac(`docs-unlock:${pinHash}`)
}

export async function currentUnlockToken(): Promise<string> {
  return unlockTokenFor(await getPinHash())
}

function isUnlockValue(token: string | undefined | null, current: string): boolean {
  return !!token && safeEqual(token, current)
}

/** Whether this device may see the documents. True when no PIN is set, or when
 *  the device holds a valid unlock cookie for the current PIN. */
export async function docsUnlocked(): Promise<boolean> {
  const hash = await getPinHash()
  if (!hash) return true // gate disabled → open
  const store = await cookies()
  const token = store.get(DOCS_COOKIE)?.value
  return isUnlockValue(token, unlockTokenFor(hash))
}
