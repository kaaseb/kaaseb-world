// Inbox secret gate — a PIN on top of the `page.inbox` permission.
//
// The customer inbox holds real client projects, so even users who CAN reach the
// page must enter a shared secret the SUPER ADMIN alone controls. State is tiny
// and lives in S3 (no DB columns) like everything else here.
//
// Security shape:
//   • The PIN is never stored — only appHmac("inbox-pin:"+pin), a one-way keyed
//     hash. A leaked S3 blob reveals nothing without the server key.
//   • Unlock is a cookie whose value is appHmac("inbox-unlock:"+pinHash). Because
//     it's derived from the CURRENT hash, changing the PIN instantly invalidates
//     every device — no session list to clear.
//   • Default PIN is 100200300 until the super admin sets one (no blob written
//     until then), so the gate works out of the box.

import { timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { readJson, writeJson } from '@/lib/s3'
import { appHmac } from '@/lib/encryption'

const KEY = 'app-data/inbox-lock.json'
const DEFAULT_PIN = '100200300'
export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 64

export const INBOX_COOKIE = 'kaaseb_inbox_unlock'
export const INBOX_COOKIE_MAXAGE = 60 * 60 * 12 // 12 hours per device

interface LockState { pinHash: string }

function hashPin(pin: string): string {
  return appHmac(`inbox-pin:${pin.trim()}`)
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

/** The active PIN hash — the stored one, or the default until a PIN is set. */
export async function getPinHash(): Promise<string> {
  const s = await readJson<LockState | null>(KEY, null)
  return s?.pinHash || hashPin(DEFAULT_PIN)
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (!pin) return false
  return safeEqual(hashPin(pin), await getPinHash())
}

/** Set a new PIN (super-admin only, enforced at the route). Returns the new
 *  unlock token so the caller can refresh its own cookie and stay in. */
export async function setPin(pin: string): Promise<{ ok: boolean; error?: string; unlockToken?: string }> {
  const clean = (pin || '').trim()
  if (clean.length < MIN_PIN_LENGTH) return { ok: false, error: `الرقم قصير — ${MIN_PIN_LENGTH} خانات على الأقل.` }
  if (clean.length > MAX_PIN_LENGTH) return { ok: false, error: 'الرقم طويل جداً.' }
  const pinHash = hashPin(clean)
  await writeJson(KEY, { pinHash })
  return { ok: true, unlockToken: unlockTokenFor(pinHash) }
}

function unlockTokenFor(pinHash: string): string {
  return appHmac(`inbox-unlock:${pinHash}`)
}

export async function currentUnlockToken(): Promise<string> {
  return unlockTokenFor(await getPinHash())
}

function isUnlockValue(token: string | undefined | null, current: string): boolean {
  return !!token && safeEqual(token, current)
}

/** Read the request cookies and say whether this device is unlocked. Works in
 *  both server components and route handlers (both use next/headers cookies). */
export async function inboxUnlocked(): Promise<boolean> {
  const store = await cookies()
  const token = store.get(INBOX_COOKIE)?.value
  return isUnlockValue(token, await currentUnlockToken())
}
