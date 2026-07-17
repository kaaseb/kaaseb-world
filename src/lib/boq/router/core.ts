// BOQ Router — core types, constants, and deterministic helpers.
//
// The router is the answer to "a project arrives as a BOQ + 200 attachments".
// Instead of dumping everything into one LLM call (token explosion, accuracy
// collapse, and the model claiming it searched files it never saw), work is
// split into phases — see ROUTER-DESIGN.md for the full design AND the autopsy
// of the three tempting ideas that are deliberately NOT used here:
//
//   ☠ cache keyed on URL        → uploads get a random suffix; same bytes,
//                                  new URL, 0% hit rate. We key on sha256(bytes).
//   ☠ lexical routing           → "بلاط رخام" vs "marble tile" share zero
//                                  characters. Routing is ONE cheap LLM call.
//   ☠ needs_resolution gating   → a row with a stated qty still gets routed,
//                                  otherwise "drawings override the BOQ on
//                                  conflict" (AGENTS.md) can never fire.
//
// THE USER'S HARD REQUIREMENT (his words: "بعض الملفات والمخططات صور ويقرأ منها
// الأرقام مو نصوص"): scanned drawings carry their numbers as PIXELS. So every
// phase here is dual-path — text pages are read as text and verified by exact
// quote-matching; visual pages are read by vision on a SINGLE extracted page
// and verified by an independent second look (a quote can't be indexOf'd
// against pixels).

import { createHash } from 'crypto'
import { readJson, writeJson } from '@/lib/s3'

// ─── caps (cost & wall-clock control) ───────────────────────────────────────

// Bump when the extractor or the index prompts change — old cache entries are
// simply never found under the new key, so a bugfix reaches every project
// without a migration. (Files never go stale; OUR CODE does.)
export const INDEX_VERSION = 1

export const MAX_SOURCES = 250 // attachments considered per run (matches BUCKET_CAP)
export const VISION_TOC_MAX_PAGES = 30 // pages of a scanned doc the TOC pass looks at
export const MAX_READ_GROUPS = 60 // (file,page) reads per run
export const MAX_CANDIDATES_PER_ROW = 3
export const INDEX_CONCURRENCY = 2 // parallel vision-TOC calls
export const AI_CALL_TIMEOUT_MS = 240_000 // no LLM call may hang the pipeline
export const PAGE_TEXT_CAP = 18_000 // chars of one page sent to a read call
export const CATALOG_CHAR_CAP = 120_000 // routing-call catalog budget

// A page with less extracted text than this is furniture (title block, stamp) —
// its real content is pixels. Mirrors MIN_PAGE_TEXT_CHARS in lib/ai/files.ts.
export const MIN_PAGE_TEXT_CHARS = 80

// ─── types ──────────────────────────────────────────────────────────────────

export type SourceBucket = 'spec' | 'drawing' | 'other'

export interface SourceRef {
  url: string
  name: string
  bucket: SourceBucket
  /** Set when the file came out of a ZIP: the entry path inside `url`. */
  zipEntry?: string
}

export interface IndexedPage {
  page: number // 1-based
  /** Extracted text, or null when the page is pixels-only (scan / drawing). */
  text: string | null
  /** One-line content summary. Deterministic for text pages, vision TOC for visual. */
  anchor: string
}

export interface IndexedFile {
  sha: string
  name: string
  bucket: SourceBucket
  source: SourceRef
  kind: 'text' | 'visual' | 'mixed' | 'unreadable'
  pageCount: number
  pages: IndexedPage[]
  /** Drawing/sheet number read off the title block, e.g. "A-301". */
  docNumber: string | null
  title: string | null
  /** true when the vision TOC only covered the first VISION_TOC_MAX_PAGES. */
  partialToc: boolean
  bytes: number
  error: string | null
}

export interface RouterRow {
  position: number // 1-based, stable across phases
  description: string
  details: string | null
  quantity: number
  /** Did the BOQ itself state this quantity? (false ⇒ 0 is a placeholder) */
  quantityStated: boolean
  unit: string
  department_match: string | null
  ai_confidence: number
  /** Free-text pointer from the BOQ row, e.g. "Sold.pdf ص40", "" if none. */
  referenceHint: string
}

export interface Candidate {
  sha: string
  page: number | null // null = whole file (small visual file without page info)
  why: string
  /** 2 = explicit citation (deterministic), 1 = router's semantic pick. */
  rank: 2 | 1
}

export interface Resolution {
  position: number
  value: number
  unit: string
  /** Verbatim text containing the number (indexOf-verified for text pages). */
  quote: string
  fileName: string
  page: number | null
  /** 'quote' = exact text match. 'double-read' = independent vision confirm. */
  verified: 'quote' | 'double-read'
  visual: boolean
}

// ─── run progress (what the UI polls) ───────────────────────────────────────

export type RunStage =
  | 'extracting' // phase 1 — reading the BOQ alone
  | 'indexing' // phase 2 — hashing/indexing attachments
  | 'routing' // phase 3 — matching rows to files
  | 'reading' // phase 4 — reading the routed pages
  | 'assembling'
  | 'done'
  | 'failed'

export interface RunProgress {
  stage: RunStage
  filesTotal: number
  filesDone: number
  filesFailed: number
  pagesRead: number
  readGroupsTotal: number
  rowsTotal: number
  rowsResolved: number
  message: string
  error: string | null
  startedAt: string
  updatedAt: string
}

const runKey = (projectId: string) => `app-data/furn-runs/${projectId}.json`

export async function readRunProgress(projectId: string): Promise<RunProgress | null> {
  return await readJson<RunProgress | null>(runKey(projectId), null)
}

export function makeProgressWriter(projectId: string) {
  let state: RunProgress = {
    stage: 'extracting',
    filesTotal: 0,
    filesDone: 0,
    filesFailed: 0,
    pagesRead: 0,
    readGroupsTotal: 0,
    rowsTotal: 0,
    rowsResolved: 0,
    message: '',
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  // Serialized writes: progress updates are frequent and S3 writes are slow;
  // chain them so they can't interleave, and never let one failing write kill
  // the pipeline (progress is telemetry, not state).
  let chain: Promise<void> = Promise.resolve()
  const push = (patch: Partial<RunProgress>) => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() }
    const snapshot = state
    chain = chain.then(() => writeJson(runKey(projectId), snapshot)).catch(() => {})
    return chain
  }
  return { push, get: () => state }
}

// ─── deterministic helpers ──────────────────────────────────────────────────

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// Arabic-aware normalisation for QUOTE VERIFICATION and file-name matching.
// A Saudi document mixes Arabic-Indic digits, harakat, ة/ه, ى/ي — the model's
// quote and the extracted page text must collapse to the same form or exact
// matching would reject genuinely correct quotes.
const AR_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

export function normalizeText(s: string): string {
  return (s || '')
    .replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d)
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // harakat
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ') // keep dots — decimals live in quotes
    .trim()
}

/**
 * The hallucination gate for TEXT pages: the model must hand back the verbatim
 * substring containing the number, and we require it to actually occur in the
 * page. An empty page cannot produce a quote that verifies — which converts the
 * silent failures (empty extraction, wrong page) into loud, rejected ones.
 */
export function quoteVerifies(pageText: string, quote: string): boolean {
  const q = normalizeText(quote)
  if (q.length < 2) return false
  return normalizeText(pageText).includes(q)
}

/** Race an AI call against a hard timeout so a hung request can never wedge the
 *  background pipeline (there is no AbortSignal in the provider layer). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: تجاوز المهلة (${Math.round(ms / 1000)}ث)`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/** Tiny promise pool — index N files with bounded concurrency, never rejecting
 *  the whole batch because one worker threw. */
export async function pooled<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, i: number) => Promise<R>,
): Promise<Array<R | Error>> {
  const out: Array<R | Error> = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await worker(items[i], i)
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e))
      }
    }
  })
  await Promise.all(lanes)
  return out
}
