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

export const MAX_SOURCES = 250 // upload URLs considered per run (matches BUCKET_CAP)
// Hard ceiling on ENTRIES actually indexed AFTER zip expansion. Without this a
// handful of zipped-scan uploads (250 uploads × 50 scanned entries each) becomes
// 12,500 vision-TOC calls. Bounds the real cost, which the URL cap does not.
export const MAX_INDEXED_ENTRIES = 400
export const READ_CONCURRENCY = 3 // parallel page reads (each is 1-2 AI calls)
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
  /** The sheet/section heading this row came from (Excel tab name). */
  section: string | null
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
  /** Which bucket the source came from — drawings alone may override the BOQ. */
  bucket: SourceBucket
  /** 'quote' = number verified in text. 'double-read' = two independent visual reads agreed. */
  verified: 'quote' | 'double-read'
  visual: boolean
}

// ─── attribute resolution (thickness / finish / size / colour / material) ───
//
// THE OWNER'S REQUIREMENT: "ملف رئيسي آخذ منه البنود، ملف ثاني الكمية، ملف ثالث
// السماكة" — a project's spec/legend/schedule files carry the attributes the BOQ
// row left out. Quantity alone is not a priceable line; thickness and finish
// decide the price. So every routed page read ALSO reports these attributes,
// under the SAME hallucination gate as quantities (verbatim quote for text pages,
// two blind agreeing reads for visual pages). Free in tokens: it rides on the
// existing per-page read call.

export interface ResolvedAttrs {
  thickness_mm: number | null
  finish: string | null
  size: string | null
  colour: string | null
  material: string | null
}

export const EMPTY_ATTRS: ResolvedAttrs = { thickness_mm: null, finish: null, size: null, colour: null, material: null }

export interface AttrResolution {
  position: number
  attrs: ResolvedAttrs
  /** Verbatim fragment(s) the attributes were read from (" | "-joined). */
  quote: string
  fileName: string
  page: number | null
  bucket: SourceBucket
  verified: 'quote' | 'double-read'
  visual: boolean
}

/** What one page read yields: quantities (as before) plus attributes. */
export interface PageReadResult {
  quantities: Resolution[]
  attributes: AttrResolution[]
}

export function hasAnyAttr(a: ResolvedAttrs | null | undefined): boolean {
  return !!a && (a.thickness_mm !== null || !!a.finish || !!a.size || !!a.colour || !!a.material)
}

/** First-writer-wins per FIELD: an earlier page's finish is kept, a later page
 *  may still fill the thickness it lacked. */
export function mergeAttrs(base: ResolvedAttrs | null, add: ResolvedAttrs): ResolvedAttrs {
  const b = base || EMPTY_ATTRS
  return {
    thickness_mm: b.thickness_mm ?? add.thickness_mm,
    finish: b.finish || add.finish,
    size: b.size || add.size,
    colour: b.colour || add.colour,
    material: b.material || add.material,
  }
}

// Thickness stated in free text, in mm — or null. Three rules, in priority
// order, because a naive "N mm" match reads the SIZE "600x600mm" as a 600 mm
// slab (a real mis-price waiting to happen):
//   1. explicit: "30mm THK", "20 mm thick", "thickness 20mm", "سماكة 3 سم", "سمك 20"
//   2. the THIRD number of a 3-D size "600 x 600 x 20 mm" — that one IS the thickness
//   3. a standalone "N mm/cm" that is not glued to an x/× (so "600x600mm" never matches)
// Arabic-Indic digits are normalised first so "٣ سم" works. The `u` flag makes
// \p{L} valid — plain \b is useless next to Arabic letters.
const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const UNIT = String.raw`(mm|مم|ملم|cm|سم)`
const THK_WORD = String.raw`(?:thk|thick(?:ness)?|سماكة|سماكه|سمك)`
const THK_AFTER_WORD = new RegExp(THK_WORD + String.raw`\D{0,8}?` + NUM + String.raw`\s*` + UNIT + '?', 'iu')
const THK_BEFORE_WORD = new RegExp(NUM + String.raw`\s*` + UNIT + String.raw`\s*` + THK_WORD, 'iu')
// Each leading dimension may carry its own unit ("750 mm x 375 mm x 100 mm").
const DIM = String.raw`\d+(?:[.,]\d+)?\s*(?:mm|مم|ملم|cm|سم)?\s*[x×*]\s*`
const THK_3D_SIZE = new RegExp(DIM + DIM + NUM + String.raw`\s*` + UNIT, 'iu')
// Rule 3 must not read "90mm wide" (a width), "5mm grouting" (a joint) or
// "2400mm high" as a thickness — so it refuses dimension/joint words and only
// accepts a plausible slab/tile range. Explicit wording (rules 1-2) is exempt.
const NOT_THICKNESS_WORDS = String.raw`(?!\s*(?:wide|width|long|length|high|height|deep|depth|dia|diameter|grout|joint|gap|spacing|عرض|عريض|طول|ارتفاع|عمق|قطر|فاصل|ترويب|فواصل))`
const THK_STANDALONE = new RegExp(String.raw`(?<![\dx×*]\s{0,2})` + NUM + String.raw`\s*` + UNIT + String.raw`(?!\s*[x×*])(?!\p{L})` + NOT_THICKNESS_WORDS, 'iu')
const PLAUSIBLE_MIN_MM = 10
const PLAUSIBLE_MAX_MM = 100

function toMm(numStr: string, unit: string | undefined): number | null {
  const n = Number(numStr.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const u = (unit || '').toLowerCase()
  return u === 'cm' || u === 'سم' ? n * 10 : n
}

/** Extract a stated thickness in mm from free text, or null when none is stated. */
export function thicknessFromText(text: string | null | undefined): number | null {
  const t = toWesternDigits(text || '')
  if (!t) return null
  let m = THK_AFTER_WORD.exec(t) || THK_BEFORE_WORD.exec(t)
  if (m) return toMm(m[1], m[2])
  m = THK_3D_SIZE.exec(t)
  if (m) return toMm(m[1], m[2])
  m = THK_STANDALONE.exec(t)
  if (m) {
    const mm = toMm(m[1], m[2])
    return mm !== null && mm >= PLAUSIBLE_MIN_MM && mm <= PLAUSIBLE_MAX_MM ? mm : null
  }
  return null
}

/** Does the BOQ's own details line already state a thickness? If so we never
 *  spend a page read looking for one. */
export function detailsStateThickness(details: string | null | undefined): boolean {
  return thicknessFromText(details) !== null
}

/**
 * Hallucination gate for ATTRIBUTE quotes on TEXT pages. Every " | "-separated
 * piece must occur verbatim in the page, and a claimed thickness must appear as
 * a real number on the page. Strings (finish/colour) are verified by the quote
 * alone — the quote IS the evidence they were read, not invented.
 */
export function attrsVerify(pageText: string, quote: string, attrs: ResolvedAttrs): boolean {
  const pieces = (quote || '').split('|').map((s) => s.trim()).filter((s) => s.length >= 2)
  if (pieces.length === 0) return false
  const page = normalizeText(pageText)
  if (!pieces.every((p) => page.includes(normalizeText(p)))) return false
  if (attrs.thickness_mm !== null) {
    const near = (n: number) => Math.abs(n - (attrs.thickness_mm as number)) < NUM_EPS
    // The number may be written in cm on the page ("3 cm" for 30 mm) — accept either.
    const cmForm = (attrs.thickness_mm as number) / 10
    const pageNums = numbersIn(pageText)
    if (!pageNums.some(near) && !pageNums.some((n) => Math.abs(n - cmForm) < NUM_EPS)) return false
  }
  return true
}

/** Two blind visual reads agree on an attribute set (per field, normalised). */
export function attrsAgree(a: ResolvedAttrs, b: ResolvedAttrs): ResolvedAttrs {
  const same = (x: string | null, y: string | null) => x && y && normalizeText(x) === normalizeText(y) ? x : null
  const thick = a.thickness_mm !== null && b.thickness_mm !== null && Math.abs(a.thickness_mm - b.thickness_mm) < NUM_EPS
    ? a.thickness_mm : null
  return { thickness_mm: thick, finish: same(a.finish, b.finish), size: same(a.size, b.size), colour: same(a.colour, b.colour), material: same(a.material, b.material) }
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
  // Coalesced, serialized writes. Progress updates fire ~270×/run (one per file,
  // per page); S3 PUTs are slow. So: always keep `state` current in memory, but
  // only flush to S3 when the last flush was ≥ MIN_FLUSH_MS ago OR the stage
  // changed OR it's the terminal state. A flush always writes the LATEST snapshot,
  // never a stale queued one. Failures are swallowed — progress is telemetry.
  const MIN_FLUSH_MS = 1500
  let chain: Promise<void> = Promise.resolve()
  let lastFlush = 0
  let lastStage: RunStage | null = null

  const flush = () => {
    const snapshot = state
    chain = chain.then(() => writeJson(runKey(projectId), snapshot)).catch(() => {})
    return chain
  }

  const push = (patch: Partial<RunProgress>) => {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() }
    const now = Date.now()
    const terminal = state.stage === 'done' || state.stage === 'failed'
    const stageChanged = state.stage !== lastStage
    if (terminal || stageChanged || now - lastFlush >= MIN_FLUSH_MS) {
      lastFlush = now
      lastStage = state.stage
      return flush()
    }
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

function toWesternDigits(s: string): string {
  return (s || '').replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d)
}

/**
 * Extract the NUMERIC VALUES from a string, tokenised so that "1,412" parses to
 * 1412 (one number) — NOT to 1 and 412. Comma = thousands, dot / ٫ = decimal
 * (the English convention Saudi BOQs follow). This is what stops a claimed
 * "412" from verifying against a page's "1,412".
 */
export function numbersIn(text: string): number[] {
  const w = toWesternDigits(text).replace(/٫/g, '.')
  const out: number[] = []
  const re = /\d[\d,]*(?:\.\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(w)) !== null) {
    const n = Number(m[0].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

const NUM_EPS = 0.01

/**
 * The hallucination gate for TEXT pages. THREE checks, all required — because
 * verifying the quote string alone (the old behaviour) decoupled the number we
 * store from the number we verified:
 *
 *   1. the quote occurs verbatim in the page   → the audit trail is real text,
 *                                                 not fabricated.
 *   2. `value` is a real number ON THE PAGE     → not a substring of a bigger
 *      (numbersIn(page) contains it)              number: "412" fails against
 *                                                 a page whose only figure is
 *                                                 "1,412".
 *   3. `value` also appears IN THE QUOTE         → the number and its own cited
 *      (numbersIn(quote) contains it)             context agree — catches a
 *                                                 transposed 186-for-168 slip
 *                                                 where the quote still holds 168.
 *
 * An empty/wrong page cannot satisfy all three, so silent failures become loud
 * rejections — which is the whole promise of the router.
 */
export function readingVerifies(pageText: string, quote: string, value: number): boolean {
  if (!quote || quote.trim().length < 2) return false
  if (!Number.isFinite(value)) return false
  if (!normalizeText(pageText).includes(normalizeText(quote))) return false
  const near = (n: number) => Math.abs(n - value) < NUM_EPS
  return numbersIn(pageText).some(near) && numbersIn(quote).some(near)
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
