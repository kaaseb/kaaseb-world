// Brute-force throttle for the PIN unlock gates (docs + inbox).
//
// The unlock routes require an authenticated session AND the page permission,
// so the attack surface is a logged-in insider guessing a short shared PIN. A
// 4-digit PIN is only ~10k combinations, so without a limiter it is guessable
// in seconds. This adds a per-user lockout: after MAX_FAILS wrong tries inside a
// rolling window, that user is frozen for a short cooldown.
//
// State is tiny and lives in S3 (no DB columns) like the rest of the app-data
// blobs. Keyed per (bucket, user) so one user's fumbling never locks another
// out, and a wrong PIN on the inbox doesn't affect the docs gate.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/unlock-throttle.json'

export const MAX_FAILS = 5              // wrong tries allowed inside the window
const WINDOW_MS = 10 * 60 * 1000        // rolling window the fails are counted in
const BLOCK_MS = 60 * 1000              // cooldown once the limit is hit
const STALE_MS = 24 * 60 * 60 * 1000    // prune entries untouched for a day

interface Entry { fails: number; firstFailAt: number; blockedUntil: number }
type State = Record<string, Entry>

function bkey(bucket: string, id: string): string {
  return `${bucket}:${id}`
}

// Drop entries that are well past any window/block so the blob can't grow
// unbounded over time.
function prune(state: State, now: number): State {
  const out: State = {}
  for (const [k, e] of Object.entries(state)) {
    const lastTouch = Math.max(e.firstFailAt || 0, e.blockedUntil || 0)
    if (now - lastTouch < STALE_MS) out[k] = e
  }
  return out
}

/** Is this (bucket, user) currently frozen? Call BEFORE verifying the PIN. */
export async function throttleStatus(bucket: string, id: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const now = Date.now()
  const state = await readJson<State>(KEY, {})
  const e = state[bkey(bucket, id)]
  if (e && e.blockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((e.blockedUntil - now) / 1000) }
  }
  return { blocked: false, retryAfterSec: 0 }
}

/** Record a wrong-PIN attempt; freezes the user once the limit is reached. */
export async function recordFailure(bucket: string, id: string): Promise<void> {
  const now = Date.now()
  const state = prune(await readJson<State>(KEY, {}), now)
  const k = bkey(bucket, id)
  const prev = state[k]
  // Reset the counter if the previous window has elapsed (or a block expired).
  let e: Entry
  if (!prev || now - prev.firstFailAt > WINDOW_MS || (prev.blockedUntil && prev.blockedUntil < now)) {
    e = { fails: 1, firstFailAt: now, blockedUntil: 0 }
  } else {
    e = { fails: prev.fails + 1, firstFailAt: prev.firstFailAt, blockedUntil: 0 }
  }
  if (e.fails >= MAX_FAILS) {
    e.blockedUntil = now + BLOCK_MS
    e.fails = 0            // fresh count after the cooldown
    e.firstFailAt = now
  }
  state[k] = e
  await writeJson(KEY, state)
}

/** Clear a user's record on a successful unlock. */
export async function clearFailures(bucket: string, id: string): Promise<void> {
  const now = Date.now()
  const state = prune(await readJson<State>(KEY, {}), now)
  const k = bkey(bucket, id)
  if (state[k]) { delete state[k]; await writeJson(KEY, state) }
}
