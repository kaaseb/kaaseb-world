// "الفرص" (Opportunities) store — one JSON blob in S3, no database table.
//
// Why S3 and not Postgres: this feature owns brand-new data with no existing
// table, and the platform's established pattern for table-less state is a
// single `app-data/*.json` object (see src/lib/visualize/jobs.ts). Keeping it
// here means the feature cannot break, lock, or migrate anything that already
// exists — it is fully isolated.
//
// HONEST LIMIT: like every other store here, the read-modify-write cycle is not
// locked. Two writers racing can lose an update. That is acceptable because the
// only writers are (a) one scheduled scan per day and (b) an occasional manual
// scan / team edit — and `beginRun()` refuses to start a second scan while one
// is already in flight.

import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/s3'
import type {
  Opportunity,
  OpportunitiesState,
  OpportunityContact,
  ScanRun,
  ScanTrigger,
} from './types'

const KEY = 'app-data/opportunities.json'

// Cap the blob so it stays small and cheap to read on every page load. At ~10
// finds/day this holds roughly a month of history; the team archives/deletes
// what it doesn't want. Oldest-and-lowest-scoring fall off first.
const MAX_ITEMS = 300

// A run that claims to be 'running' for longer than this is treated as dead
// (server restarted mid-scan), so a stuck flag can never block scans forever.
//
// Sized against the WORST case a real scan can take, not the typical one: four
// sectors, each able to retry a 429 a couple of times with a backoff wait, plus
// the gaps between sectors. A healthy scan is 2-5 minutes; this must sit well
// above the pathological tail or we declare a working scan dead and confuse the
// team (which is exactly what a 15-minute window did in production).
const STALE_RUN_MS = 30 * 60 * 1000

const EMPTY: OpportunitiesState = { items: [], lastRun: null }

// ─── raw read/write ─────────────────────────────────────────────────────────

async function readState(): Promise<OpportunitiesState> {
  const s = await readJson<OpportunitiesState>(KEY, EMPTY)
  // Defend against a hand-edited / half-written blob.
  return {
    items: Array.isArray(s?.items) ? s.items : [],
    lastRun: s?.lastRun ?? null,
  }
}

async function writeState(state: OpportunitiesState): Promise<void> {
  // Trim on the way out: keep the highest-value items, newest first.
  const items = [...state.items]
    .sort(byPriority)
    .slice(0, MAX_ITEMS)
  await writeJson(KEY, { items, lastRun: state.lastRun })
}

// Newest first, but a high score outranks a slightly older date — the team
// wants the biggest fish on top, not merely the freshest.
function byPriority(a: Opportunity, b: Opportunity): number {
  const s = (b.score || 0) - (a.score || 0)
  if (s !== 0) return s
  return (b.createdAt || '').localeCompare(a.createdAt || '')
}

// ─── dedup ──────────────────────────────────────────────────────────────────

// Arabic-aware normalisation so "مشروع البرج الشمالي" and "مشروع البرج
// الشمالى" (different ya) collapse to the same key, and so English casing /
// punctuation never produces a duplicate card.
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // harakat
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function fingerprintOf(title: string, owner: string): string {
  return `${normalize(title)}|${normalize(owner)}`
}

// Strip tracking params / trailing slashes so the same article via two links
// isn't counted twice.
function canonicalUrl(u: string): string {
  try {
    const url = new URL(u)
    url.hash = ''
    url.search = ''
    return `${url.host}${url.pathname}`.replace(/\/+$/, '').toLowerCase()
  } catch {
    return (u || '').trim().toLowerCase()
  }
}

// ─── public reads ───────────────────────────────────────────────────────────

export async function getState(): Promise<OpportunitiesState> {
  const state = await readState()
  return { items: [...state.items].sort(byPriority), lastRun: markStaleRun(state.lastRun) }
}

// Display-only: a 'running' run older than STALE_RUN_MS is reported as failed.
// Computed on read (never persisted) so we don't race the background writer —
// same trick the visualize store uses.
function markStaleRun(run: ScanRun | null): ScanRun | null {
  if (!run || run.status !== 'running') return run
  if (Date.now() - new Date(run.startedAt).getTime() <= STALE_RUN_MS) return run
  return {
    ...run,
    status: 'failed',
    finishedAt: run.finishedAt,
    error: run.error || 'توقف البحث قبل ما يكمل (السيرفر أعاد التشغيل).',
  }
}

// ─── team edits ─────────────────────────────────────────────────────────────

export async function updateOpportunity(
  id: string,
  patch: Partial<Pick<Opportunity, 'status' | 'notes'>>,
): Promise<Opportunity | null> {
  const state = await readState()
  const idx = state.items.findIndex((o) => o.id === id)
  if (idx < 0) return null
  state.items[idx] = { ...state.items[idx], ...patch, updatedAt: new Date().toISOString() }
  await writeState(state)
  return state.items[idx]
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const state = await readState()
  return state.items.find((o) => o.id === id) ?? null
}

// Result of the dedicated contact hunt. Stamped even when nothing was found, so
// the card can say "we looked, there's nothing published" instead of offering
// the button again and burning another search on the same dead end.
export async function setContacts(
  id: string,
  contacts: OpportunityContact[],
): Promise<Opportunity | null> {
  const state = await readState()
  const idx = state.items.findIndex((o) => o.id === id)
  if (idx < 0) return null
  const now = new Date().toISOString()
  state.items[idx] = { ...state.items[idx], contacts, contactsFetchedAt: now, updatedAt: now }
  await writeState(state)
  return state.items[idx]
}

export async function deleteOpportunity(id: string): Promise<boolean> {
  const state = await readState()
  if (!state.items.some((o) => o.id === id)) return false
  state.items = state.items.filter((o) => o.id !== id)
  await writeState(state)
  return true
}

// ─── run lifecycle ──────────────────────────────────────────────────────────

// Claims the "a scan is in flight" flag. Returns null when one is already
// running, which is how both the cron tick and the manual button avoid
// stacking duplicate (and billable) searches on top of each other.
export async function beginRun(trigger: ScanTrigger, by: string | null): Promise<ScanRun | null> {
  const state = await readState()
  const current = markStaleRun(state.lastRun)
  if (current?.status === 'running') return null

  const run: ScanRun = {
    status: 'running',
    trigger,
    by,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    found: 0,
    added: 0,
    error: null,
  }
  await writeState({ ...state, lastRun: run })
  return run
}

export async function finishRun(patch: Partial<ScanRun>): Promise<void> {
  const state = await readState()
  if (!state.lastRun) return
  await writeState({
    ...state,
    lastRun: { ...state.lastRun, finishedAt: new Date().toISOString(), ...patch },
  })
}

// When did we last complete a scan successfully? Used by the boot catch-up so
// a restart at 02:59 doesn't silently skip the day.
export async function lastSuccessfulRunAt(): Promise<Date | null> {
  const state = await readState()
  const run = state.lastRun
  if (!run || run.status !== 'done' || !run.finishedAt) return null
  const d = new Date(run.finishedAt)
  return Number.isNaN(d.getTime()) ? null : d
}

// ─── merge ──────────────────────────────────────────────────────────────────

// Everything the AI is allowed to fill in. `status`/`notes` are deliberately
// absent — those belong to the team.
export type NewOpportunity = Omit<
  Opportunity,
  'id' | 'status' | 'notes' | 'fingerprint' | 'createdAt' | 'updatedAt'
>

// Adds only the genuinely new finds and RETURNS them — the caller needs the
// rows themselves, not a tally, to decide what's worth notifying about.
//
// A candidate is a duplicate when it shares a fingerprint (same project + same
// owner) OR any source URL with something we already hold — daily scans
// re-surface the same news constantly, and the team must never open this page
// to a wall of repeats.
export async function mergeFindings(found: NewOpportunity[]): Promise<Opportunity[]> {
  const state = await readState()

  const seenPrints = new Set(state.items.map((o) => o.fingerprint))
  const seenUrls = new Set(state.items.flatMap((o) => (o.sourceUrls || []).map(canonicalUrl)))

  const now = new Date().toISOString()
  const added: Opportunity[] = []

  for (const f of found) {
    const fingerprint = fingerprintOf(f.title, f.owner)
    if (!fingerprint.replace('|', '').trim()) continue // junk row, no title or owner
    if (seenPrints.has(fingerprint)) continue

    const urls = (f.sourceUrls || []).map(canonicalUrl)
    if (urls.some((u) => u && seenUrls.has(u))) continue

    const row: Opportunity = {
      ...f,
      id: randomUUID(),
      status: 'new',
      notes: '',
      fingerprint,
      createdAt: now,
      updatedAt: now,
    }
    state.items.unshift(row)
    added.push(row)
    seenPrints.add(fingerprint)
    urls.forEach((u) => u && seenUrls.add(u))
  }

  if (added.length > 0) await writeState(state)
  return added
}
