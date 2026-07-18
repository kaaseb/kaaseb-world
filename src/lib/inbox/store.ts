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
  bodyText: string // trimmed plain-text preview (empty until hydrated)
  attachments: EmailAttachment[] // empty until hydrated
  preview: EmailPreview | null // stage-1 AI summary (null until hydrated)
  status: EmailStatus
  // Set once converted, so the card can link to the created project.
  projectId: string | null
  createdAt: string
  // ── Two-tier intake ────────────────────────────────────────────────────────
  // A LIST sync stores only the cheap envelope (subject/from/date/count) for
  // hundreds of messages. The heavy part — downloading the 200 attachments to S3
  // and running the AI summary — happens on demand, per message the owner picks,
  // via hydrateEmail(). `hydrated` says which tier a record is at.
  hydrated: boolean // false = envelope only; true = attachments + preview fetched
  attachmentCount: number // from the IMAP bodyStructure — shown before hydration
  size: number // whole-message bytes (IMAP SIZE), gated before we download it
  uid: number | null // IMAP UID, so hydrateEmail can re-fetch just this message
  uidValidity: number | null // guards the UID (a mailbox reset invalidates it)
  folder: string // the mailbox the UID belongs to
}

// The lightweight envelope a LIST sync produces — no bytes pulled, no AI.
export interface ListedEmail {
  id: string
  subject: string
  fromName: string
  fromEmail: string
  date: string
  attachmentCount: number
  size: number
  uid: number
  uidValidity: number
  folder: string
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

// Records written before the two-tier split have no `hydrated` flag — they were
// always fully fetched, so normalise them to hydrated=true. Keeps old inboxes
// working without a migration.
function normalize(e: InboxEmail): InboxEmail {
  if (typeof e.hydrated === 'boolean') return e
  return {
    ...e,
    hydrated: true,
    attachmentCount: Array.isArray(e.attachments) ? e.attachments.length : 0,
    size: e.size ?? 0,
    uid: e.uid ?? null,
    uidValidity: e.uidValidity ?? null,
    folder: e.folder || 'INBOX',
  }
}

async function readState(): Promise<InboxState> {
  const s = await readJson<InboxState>(KEY, EMPTY)
  const items = Array.isArray(s?.items) ? s.items.map(normalize) : []
  return { items, lastRun: s?.lastRun ?? null }
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

// A LIST sync writes these envelopes. New ids become fresh listed (un-hydrated)
// records; ids we already hold get their envelope + UID refreshed WITHOUT ever
// downgrading a hydrated record (its attachments/preview/status are preserved).
// Returns how many were brand new.
export async function upsertListed(listed: ListedEmail[]): Promise<number> {
  const s = await readState()
  const byId = new Map(s.items.map((e) => [e.id, e]))
  const now = new Date().toISOString()
  let added = 0
  for (const l of listed) {
    if (!l.id) continue
    const existing = byId.get(l.id)
    if (existing) {
      // Refresh envelope + re-fetch coordinates; keep everything hydration set.
      existing.subject = l.subject || existing.subject
      existing.fromName = l.fromName || existing.fromName
      existing.fromEmail = l.fromEmail || existing.fromEmail
      existing.date = l.date || existing.date
      existing.size = l.size || existing.size
      existing.uid = l.uid
      existing.uidValidity = l.uidValidity
      existing.folder = l.folder
      if (!existing.hydrated) existing.attachmentCount = l.attachmentCount
      continue
    }
    const rec: InboxEmail = {
      id: l.id,
      subject: l.subject,
      fromName: l.fromName,
      fromEmail: l.fromEmail,
      date: l.date,
      bodyText: '',
      attachments: [],
      preview: null,
      status: 'new',
      projectId: null,
      createdAt: now,
      hydrated: false,
      attachmentCount: l.attachmentCount,
      size: l.size,
      uid: l.uid,
      uidValidity: l.uidValidity,
      folder: l.folder,
    }
    s.items.unshift(rec)
    byId.set(l.id, rec)
    added++
  }
  await writeState(s)
  return added
}

// Second tier: fold a message's downloaded body/attachments/summary onto its
// listed record and mark it hydrated.
export async function applyHydration(
  id: string,
  patch: { bodyText: string; attachments: EmailAttachment[]; preview: EmailPreview | null },
): Promise<InboxEmail | null> {
  const s = await readState()
  const idx = s.items.findIndex((e) => e.id === id)
  if (idx < 0) return null
  s.items[idx] = {
    ...s.items[idx],
    bodyText: patch.bodyText,
    attachments: patch.attachments,
    preview: patch.preview,
    attachmentCount: patch.attachments.length,
    hydrated: true,
  }
  await writeState(s)
  return s.items[idx]
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
