// Brute-force throttle for the PIN unlock gates (docs + inbox).
//
// The unlock routes require an authenticated session AND the page permission,
// so the attack surface is a logged-in insider guessing a short shared PIN. A
// 4-digit PIN is only ~10k combinations, so without a limiter it is guessable
// in seconds. This adds a per-user lockout: after MAX_FAILS attempts inside a
// rolling window, that user is frozen for a short cooldown.
//
// The count is consumed ATOMICALLY (S3 conditional write via mutateJson) and
// BEFORE the PIN is verified — so firing many guesses in parallel can't race the
// counter down: each attempt serializes on the blob and the (MAX_FAILS+1)-th is
// rejected before it ever checks a PIN. State is tiny and lives in S3 (no DB),
// keyed per (bucket, user) so one user's fumbling never locks another out.

import { mutateJson, writeJson, readJson } from '@/lib/s3'

const KEY = 'app-data/unlock-throttle.json'

export const MAX_FAILS = 5              // attempts allowed inside the window
const WINDOW_MS = 10 * 60 * 1000        // rolling window the attempts are counted in
const BLOCK_MS = 60 * 1000              // cooldown once the limit is hit
const STALE_MS = 24 * 60 * 60 * 1000    // prune entries untouched for a day

interface Entry { count: number; firstAt: number; blockedUntil: number }
type State = Record<string, Entry>

function bkey(bucket: string, id: string): string {
  return `${bucket}:${id}`
}

// Drop entries well past any window/block so the blob can't grow unbounded.
function prune(state: State, now: number): State {
  const out: State = {}
  for (const [k, e] of Object.entries(state)) {
    const lastTouch = Math.max(e.firstAt || 0, e.blockedUntil || 0)
    if (now - lastTouch < STALE_MS) out[k] = e
  }
  return out
}

/**
 * Count one unlock attempt and report whether the user is (now) frozen. Call
 * this BEFORE verifying the PIN. If it returns blocked, reject without checking.
 * Atomic: concurrent calls each land a distinct increment, so a parallel burst
 * cannot exceed MAX_FAILS guesses before the block engages.
 */
export async function consumeAttempt(bucket: string, id: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const k = bkey(bucket, id)
  let blocked = false
  let retryAfterSec = 0
  await mutateJson<State>(KEY, {}, (raw) => {
    const now = Date.now()
    const state = prune({ ...raw }, now)
    const e = state[k]

    // Already frozen → keep as-is, report the remaining cooldown, don't count.
    if (e && e.blockedUntil > now) {
      blocked = true
      retryAfterSec = Math.ceil((e.blockedUntil - now) / 1000)
      return state
    }

    // Start a fresh window if none / the previous one elapsed / a block expired.
    let next: Entry
    if (!e || now - e.firstAt > WINDOW_MS || (e.blockedUntil && e.blockedUntil <= now)) {
      next = { count: 1, firstAt: now, blockedUntil: 0 }
    } else {
      next = { count: e.count + 1, firstAt: e.firstAt, blockedUntil: 0 }
    }

    if (next.count >= MAX_FAILS) {
      next.blockedUntil = now + BLOCK_MS
      blocked = true
      retryAfterSec = Math.ceil(BLOCK_MS / 1000)
    }
    state[k] = next
    return state
  })
  return { blocked, retryAfterSec }
}

/** Clear a user's record on a successful unlock (best-effort, non-atomic). */
export async function clearFailures(bucket: string, id: string): Promise<void> {
  const now = Date.now()
  const state = prune(await readJson<State>(KEY, {}), now)
  const k = bkey(bucket, id)
  if (state[k]) { delete state[k]; await writeJson(KEY, state) }
}
