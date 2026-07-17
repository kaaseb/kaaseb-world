// "صندوق الوارد" — pulled Titan emails, persisted in S3.
//
// Shape borrowed from lib/opportunities/store.ts: a single non-stacking "pull"
// run plus a deduped list of items. An email pull IS exactly that — one periodic
// job that must never run twice at once, producing many records deduped by a
// stable key (the IMAP Message-ID).
//
// Attachment BYTES are NOT stored here — they go to S3 via uploadBufferToS3 and
// only their URLs live on the record. This blob stays small and cheap to read.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/inbox.json'
const MAX_EMAILS = 500
const STALE_RUN_MS = 15 * 60 * 1000

export type EmailStatus = 'new' | 'converted' | 'archived'

export interface EmailAttachment {
  name: string
  url: string
  key: string
  bytes: number
  contentType: string
  // Best-effort bucket guess (boq/spec/drawing/other) so the convert step has a
  // sensible default; the team can re-file in the Furn form.
  category: 'boq' | 'spec' | 'drawing' | 'other'
}

// Stage-1 preview, produced by a small AI pass at pull time. Optional because a
// summary is a nice-to-have — a pull must never fail because the model did, and
// older records simply won't carry it.
export interface EmailPreview {
  projectName: string // AI's cleaned project title (falls back to subject)
  summary: string // 2-3 sentences: what this project is
  highlights: string[] // key facts: "فيه جدول كميات", "موعد التسليم 15 أغسطس", "3 أبراج"
}

export interface InboxEmail {
  id: string // = the IMAP Message-ID (also the dedup key)
  subject: string
  fromName: string
  fromEmail: string
  date: string // ISO — the receipt date
  bodyText: string // trimmed plain-text preview
  attachments: EmailAttachment[]
  preview: EmailPreview | null // stage-1 AI summary
  status: EmailStatus
  // Set once converted, so the card can link to the created project.
  projectId: string | null
  createdAt: string
}

export type PullStatus = 'running' | 'done' | 'failed'
export type PullTrigger = 'schedule' | 'manual'

export interface PullRun {
  status: PullStatus
  trigger: PullTrigger
  by: string | null
  startedAt: string
  finishedAt: string | null
  fetched: number // messages seen
  added: number // new emails stored
  error: string | null
}

export interface InboxState {
  items: InboxEmail[]
  lastRun: PullRun | null
}

const EMPTY: InboxState = { items: [], lastRun: null }

async function readState(): Promise<InboxState> {
  const s = await readJson<InboxState>(KEY, EMPTY)
  return { items: Array.isArray(s?.items) ? s.items : [], lastRun: s?.lastRun ?? null }
}

async function writeState(state: InboxState): Promise<void> {
  const items = [...state.items]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_EMAILS)
  await writeJson(KEY, { items, lastRun: state.lastRun })
}

function markStaleRun(run: PullRun | null): PullRun | null {
  if (!run || run.status !== 'running') return run
  if (Date.now() - new Date(run.startedAt).getTime() <= STALE_RUN_MS) return run
  return { ...run, status: 'failed', error: run.error || 'توقف السحب قبل ما يكمل.' }
}

export async function getInboxState(): Promise<InboxState> {
  const s = await readState()
  return { items: s.items, lastRun: markStaleRun(s.lastRun) }
}

export async function getEmail(id: string): Promise<InboxEmail | null> {
  const s = await readState()
  return s.items.find((e) => e.id === id) ?? null
}

/** Message-IDs we already hold — passed to the IMAP fetch so it skips them. */
export async function knownMessageIds(): Promise<Set<string>> {
  const s = await readState()
  return new Set(s.items.map((e) => e.id))
}

export async function beginPull(trigger: PullTrigger, by: string | null): Promise<PullRun | null> {
  const s = await readState()
  if (markStaleRun(s.lastRun)?.status === 'running') return null
  const run: PullRun = {
    status: 'running', trigger, by,
    startedAt: new Date().toISOString(), finishedAt: null,
    fetched: 0, added: 0, error: null,
  }
  await writeState({ ...s, lastRun: run })
  return run
}

export async function finishPull(patch: Partial<PullRun>): Promise<void> {
  const s = await readState()
  if (!s.lastRun) return
  await writeState({ ...s, lastRun: { ...s.lastRun, finishedAt: new Date().toISOString(), ...patch } })
}

export async function lastSuccessfulPullAt(): Promise<Date | null> {
  const s = await readState()
  const r = s.lastRun
  if (!r || r.status !== 'done' || !r.finishedAt) return null
  const d = new Date(r.finishedAt)
  return Number.isNaN(d.getTime()) ? null : d
}

// The pull builds these; `preview` is included (added by the summarize pass).
export type NewEmail = Omit<InboxEmail, 'id' | 'status' | 'projectId' | 'createdAt'> & { id: string }

/** Add fetched emails, skipping any Message-ID we already stored. Returns count. */
export async function addEmails(emails: NewEmail[]): Promise<number> {
  const s = await readState()
  const seen = new Set(s.items.map((e) => e.id))
  const now = new Date().toISOString()
  let added = 0
  for (const e of emails) {
    if (!e.id || seen.has(e.id)) continue
    s.items.unshift({ ...e, status: 'new', projectId: null, createdAt: now })
    seen.add(e.id)
    added++
  }
  if (added > 0) await writeState(s)
  return added
}

export async function updateEmail(
  id: string,
  patch: Partial<Pick<InboxEmail, 'status' | 'projectId'>>,
): Promise<InboxEmail | null> {
  const s = await readState()
  const idx = s.items.findIndex((e) => e.id === id)
  if (idx < 0) return null
  s.items[idx] = { ...s.items[idx], ...patch }
  await writeState(s)
  return s.items[idx]
}

export async function deleteEmail(id: string): Promise<boolean> {
  const s = await readState()
  if (!s.items.some((e) => e.id === id)) return false
  s.items = s.items.filter((e) => e.id !== id)
  await writeState(s)
  return true
}
