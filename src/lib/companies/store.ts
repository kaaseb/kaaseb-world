// "شركات مستهدفة" store — one JSON blob in S3, no database table.
// Mirrors lib/opportunities/store.ts exactly; see that file for the reasoning
// behind the pattern (isolation, no migrations, no locking needed at this scale).

import { randomUUID } from 'crypto'
import { readJson, writeJson } from '@/lib/s3'
import type {
  TargetCompany,
  CompaniesState,
  CompanyContact,
  CompanyScanRun,
  CompanyScanTrigger,
} from './types'

const KEY = 'app-data/target-companies.json'

// Higher than the opportunities cap: an account list is meant to grow and be
// kept, unlike leads which go stale.
const MAX_ITEMS = 500

const STALE_RUN_MS = 30 * 60 * 1000

const EMPTY: CompaniesState = { items: [], lastRun: null }

async function readState(): Promise<CompaniesState> {
  const s = await readJson<CompaniesState>(KEY, EMPTY)
  return {
    items: Array.isArray(s?.items) ? s.items : [],
    lastRun: s?.lastRun ?? null,
  }
}

async function writeState(state: CompaniesState): Promise<void> {
  const items = [...state.items].sort(byPriority).slice(0, MAX_ITEMS)
  await writeJson(KEY, { items, lastRun: state.lastRun })
}

function byPriority(a: TargetCompany, b: TargetCompany): number {
  const s = (b.score || 0) - (a.score || 0)
  if (s !== 0) return s
  return (b.createdAt || '').localeCompare(a.createdAt || '')
}

// Arabic-aware, so "شركة لنكس للمقاولات" and "لنكس للمقاولات" collapse.
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    // Strip the boilerplate that makes the same firm look like three firms.
    .replace(/\b(شركه|مؤسسه|مجموعه|company|co|corp|group|est|ltd|llc|est)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function companyFingerprint(name: string): string {
  return normalize(name)
}

export async function getCompaniesState(): Promise<CompaniesState> {
  const state = await readState()
  return { items: [...state.items].sort(byPriority), lastRun: markStaleRun(state.lastRun) }
}

function markStaleRun(run: CompanyScanRun | null): CompanyScanRun | null {
  if (!run || run.status !== 'running') return run
  if (Date.now() - new Date(run.startedAt).getTime() <= STALE_RUN_MS) return run
  return {
    ...run,
    status: 'failed',
    error: run.error || 'توقف البحث قبل ما يكمل (السيرفر أعاد التشغيل).',
  }
}

export async function getCompany(id: string): Promise<TargetCompany | null> {
  const state = await readState()
  return state.items.find((c) => c.id === id) ?? null
}

export async function updateCompany(
  id: string,
  patch: Partial<Pick<TargetCompany, 'status' | 'notes'>>,
): Promise<TargetCompany | null> {
  const state = await readState()
  const idx = state.items.findIndex((c) => c.id === id)
  if (idx < 0) return null
  state.items[idx] = { ...state.items[idx], ...patch, updatedAt: new Date().toISOString() }
  await writeState(state)
  return state.items[idx]
}

export async function setCompanyContacts(
  id: string,
  contacts: CompanyContact[],
): Promise<TargetCompany | null> {
  const state = await readState()
  const idx = state.items.findIndex((c) => c.id === id)
  if (idx < 0) return null
  const now = new Date().toISOString()
  state.items[idx] = { ...state.items[idx], contacts, contactsFetchedAt: now, updatedAt: now }
  await writeState(state)
  return state.items[idx]
}

export async function deleteCompany(id: string): Promise<boolean> {
  const state = await readState()
  if (!state.items.some((c) => c.id === id)) return false
  state.items = state.items.filter((c) => c.id !== id)
  await writeState(state)
  return true
}

export async function beginCompanyRun(
  trigger: CompanyScanTrigger,
  by: string | null,
): Promise<CompanyScanRun | null> {
  const state = await readState()
  const current = markStaleRun(state.lastRun)
  if (current?.status === 'running') return null

  const run: CompanyScanRun = {
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

export async function finishCompanyRun(patch: Partial<CompanyScanRun>): Promise<void> {
  const state = await readState()
  if (!state.lastRun) return
  await writeState({
    ...state,
    lastRun: { ...state.lastRun, finishedAt: new Date().toISOString(), ...patch },
  })
}

export async function lastSuccessfulCompanyRunAt(): Promise<Date | null> {
  const state = await readState()
  const run = state.lastRun
  if (!run || run.status !== 'done' || !run.finishedAt) return null
  const d = new Date(run.finishedAt)
  return Number.isNaN(d.getTime()) ? null : d
}

export type NewCompany = Omit<
  TargetCompany,
  'id' | 'status' | 'notes' | 'fingerprint' | 'createdAt' | 'updatedAt' | 'contactsFetchedAt'
>

// Dedup on the company NAME only — unlike opportunities there's no source-URL
// angle, because the same firm legitimately shows up via a dozen different
// articles and it's still one account.
export async function mergeCompanies(found: NewCompany[]): Promise<number> {
  const state = await readState()
  const seen = new Set(state.items.map((c) => c.fingerprint))
  const now = new Date().toISOString()
  let added = 0

  for (const f of found) {
    const fingerprint = companyFingerprint(f.name)
    if (!fingerprint) continue
    if (seen.has(fingerprint)) continue

    state.items.unshift({
      ...f,
      id: randomUUID(),
      status: 'new',
      notes: '',
      contactsFetchedAt: null,
      fingerprint,
      createdAt: now,
      updatedAt: now,
    })
    seen.add(fingerprint)
    added++
  }

  if (added > 0) await writeState(state)
  return added
}
