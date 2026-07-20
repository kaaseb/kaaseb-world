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
  summary: string // 2-3 sentences: what this project is — ALWAYS Arabic
  highlights: string[] // key facts: "فيه جدول كميات", "موعد التسليم 15 أغسطس", "3 أبراج"
  // The terms/conditions the CUSTOMER is asking us to answer in the quotation
  // (unit price, delivery lead time, payment terms, validity, warranty, MOQ…).
  // Surfaced highlighted in the inbox and copied into the project so the pricer
  // sees them. Empty when the email states none.
  requirements: string[]
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
  // ── Threading ──────────────────────────────────────────────────────────────
  // A conversation shows as ONE item with its replies nested. inReplyTo is the
  // parent's Message-ID (from the envelope); threadId groups a whole thread and
  // is recomputed on every sync (header chain, then same-subject+sender).
  inReplyTo: string | null
  threadId: string
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
  inReplyTo: string | null
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
  const out = { ...e }
  if (typeof out.hydrated !== 'boolean') {
    out.hydrated = true
    out.attachmentCount = Array.isArray(e.attachments) ? e.attachments.length : 0
    out.size = e.size ?? 0
    out.uid = e.uid ?? null
    out.uidValidity = e.uidValidity ?? null
    out.folder = e.folder || 'INBOX'
  }
  // Threading fields (added later) — an old record is its own single-email thread.
  if (out.inReplyTo === undefined) out.inReplyTo = null
  if (!out.threadId) out.threadId = out.id
  return out
}

// Strip repeated Re:/Fwd:/رد: prefixes so replies group with their root.
function normalizeSubject(s: string): string {
  let t = (s || '').trim()
  for (;;) {
    const stripped = t.replace(/^\s*(re|fwd|fw|رد|اعاده توجيه|إعادة توجيه)\s*:\s*/i, '')
    if (stripped === t) break
    t = stripped
  }
  return t.trim().toLowerCase()
}

// Assign every email a threadId (mutates in place). Two passes of union-find:
//   1) header chain — inReplyTo → the parent's Message-ID (rebuilds full threads
//      even from just the immediate-parent link).
//   2) fallback — same normalized subject AND same sender, for replies that
//      arrived without a proper In-Reply-To. Requires a substantial subject so
//      generic one-word subjects don't over-merge.
// threadId = the id of the EARLIEST message in the component (stable as replies
// keep arriving).
function recomputeThreads(items: InboxEmail[]): void {
  const n = items.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { let r = x; while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r] } return r }
  const union = (a: number, b: number) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb }

  const byMsgId = new Map<string, number>()
  items.forEach((e, i) => { if (e.id) byMsgId.set(e.id, i) })

  items.forEach((e, i) => {
    if (e.inReplyTo && byMsgId.has(e.inReplyTo)) union(i, byMsgId.get(e.inReplyTo) as number)
  })

  const byKey = new Map<string, number>()
  items.forEach((e, i) => {
    const subj = normalizeSubject(e.subject)
    if (subj.length < 6) return
    const key = `${subj}|${(e.fromEmail || '').toLowerCase()}`
    const seen = byKey.get(key)
    if (seen === undefined) byKey.set(key, i)
    else union(i, seen)
  })

  const earliestOf = new Map<number, number>()
  items.forEach((_, i) => {
    const r = find(i)
    const cur = earliestOf.get(r)
    if (cur === undefined || (items[i].date || '') < (items[cur].date || '')) earliestOf.set(r, i)
  })
  items.forEach((e, i) => {
    const root = earliestOf.get(find(i))
    e.threadId = root !== undefined ? items[root].id : e.id
  })
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
      inReplyTo: l.inReplyTo,
      threadId: l.id, // provisional; recomputeThreads fixes it below
    }
    s.items.unshift(rec)
    byId.set(l.id, rec)
    added++
  }
  recomputeThreads(s.items)
  await writeState(s)
  return added
}

/** All emails in a thread, oldest first. */
export async function getThreadEmails(threadId: string): Promise<InboxEmail[]> {
  const s = await readState()
  return s.items
    .filter((e) => e.threadId === threadId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

/** Apply a status/projectId patch to EVERY email in a thread (convert/archive
 *  act on the whole conversation the owner sees as one item). */
export async function updateThread(
  threadId: string,
  patch: Partial<Pick<InboxEmail, 'status' | 'projectId'>>,
): Promise<number> {
  const s = await readState()
  let changed = 0
  for (const e of s.items) {
    if (e.threadId === threadId) { Object.assign(e, patch); changed++ }
  }
  if (changed > 0) await writeState(s)
  return changed
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

/** Delete every email in a thread (the inbox treats a thread as one item). */
export async function deleteThread(threadId: string): Promise<number> {
  const s = await readState()
  const before = s.items.length
  s.items = s.items.filter((e) => e.threadId !== threadId)
  const removed = before - s.items.length
  if (removed > 0) await writeState(s)
  return removed
}
