// BOQ Router — phases 3 & 4: route rows to pages, then read ONLY those pages.
//
// Routing is dual:
//   • EXPLICIT citations ("Sold.pdf ص40", "refer to A-301") resolve in CODE —
//     obeying a written pointer beats any guess, and it works even for pages the
//     vision TOC never covered (page 40 of a 400-page scan).
//   • Everything else routes through ONE LLM call over the compact index —
//     semantic and bilingual, so "بلاط رخام اللوبي" finds the page indexed as
//     "Ground floor finishes schedule". (Lexical matching provably can't.)
//
// Reading is dual too — the user's core requirement:
//   • TEXT page  → model reads the page text and must return the VERBATIM
//     substring containing each number; we indexOf-verify it or reject.
//   • VISUAL page (scan/photo/drawing) → the single page is extracted with
//     pdf-lib and read by vision, restricted to tabulated numbers and written
//     dimension labels — NEVER measuring geometry. Since a quote can't be
//     verified against pixels, a SECOND independent vision call re-reads the
//     page and must confirm each value ("double-read") before it's accepted.

import { getProvider } from '@/lib/ai'
import type { AiFile, JsonSchema } from '@/lib/ai/provider'
import { mimeFromName } from '@/lib/ai/files'
import {
  AI_CALL_TIMEOUT_MS, CATALOG_CHAR_CAP, MAX_CANDIDATES_PER_ROW, PAGE_TEXT_CAP,
  normalizeText, readingVerifies, withTimeout,
  type Candidate, type IndexedFile, type Resolution, type RouterRow,
} from './core'
import { extractPdfPageRange, refetchBytes } from './indexer'

// ─── explicit citations (deterministic) ─────────────────────────────────────

// "p.40" / "page 40" / "ص 40" / "صفحة ٤٠" / "sheet 3" — AFTER normalizeText,
// so Arabic digits are already western and "صفحة" arrives as "صفحه" (ة→ه).
// Matching the pretty spellings here silently matched nothing; that exact bug
// shipped once and was caught by a unit test.
const PAGE_REF = /(?:^|\s)(?:p|pg|page|sheet|ص|صفحه|ورقه|لوحه)\s*\.?\s*(\d{1,4})(?:\s|$)/i

export function pageFromHint(hint: string): number | null {
  const m = PAGE_REF.exec(normalizeText(hint))
  return m ? Number(m[1]) : null
}

// TOKEN-boundary match, not substring. `resolveExplicitHint` used
// `normHint.includes(stem)`, so file "A-30.pdf" (stem "a 30") matched a hint
// "refer to A-301" ("a 301".includes("a 30") = true), and docNumber "12" matched
// any hint containing "12". A citation must match a WHOLE token.
// Split on whitespace AND dots — normalizeText keeps dots (for decimals in
// quotes), but "Sold.pdf" must tokenize to {sold, pdf} so a hint's "sold"
// matches the stem, not fail against the single token "sold.pdf".
function tokenize(s: string): string[] {
  return normalizeText(s).split(/[\s.]+/).filter(Boolean)
}
function tokens(s: string): Set<string> {
  return new Set(tokenize(s))
}
function hasToken(hintTokens: Set<string>, needle: string): boolean {
  const parts = tokenize(needle).filter((w) => w.length >= 2)
  return parts.length > 0 && parts.every((w) => hintTokens.has(w))
}

/**
 * Resolve a row's EXPLICIT citation ("Sold.pdf ص40", "refer to A-301") to files.
 * Only real pointers reach here — phase 1 emits reference_hint verbatim, empty
 * when the row has none, so a loose search phrase can no longer masquerade as a
 * citation. Matching is whole-token, and a page number is applied ONLY when the
 * hint cites exactly ONE file (otherwise "p.40 of Sold.pdf, see A-301" would
 * read page 40 of A-301 too).
 */
export function resolveExplicitHint(hint: string, files: IndexedFile[]): Candidate[] {
  const raw = (hint || '').trim()
  if (!raw) return []
  const hintTokens = tokens(raw)
  if (hintTokens.size === 0) return []
  const wantedPage = pageFromHint(raw)

  const matched: IndexedFile[] = []
  for (const f of files) {
    const stem = f.name.replace(/\.[a-z0-9]+$/i, '')
    // A file is cited when its doc-number token, or a DISTINCTIVE stem token
    // (length ≥ 4, e.g. "sold", "annex"), appears as a whole token in the hint.
    const byDoc = f.docNumber ? hasToken(hintTokens, f.docNumber) : false
    const byStem =
      hasToken(hintTokens, stem) ||
      tokenize(stem).some((w) => w.length >= 4 && hintTokens.has(w))
    if (byDoc || byStem) matched.push(f)
  }
  if (matched.length === 0) return []

  // Page only when unambiguous (single cited file). With several files cited we
  // can't safely say which one the page belongs to, so target the whole file.
  const applyPage = matched.length === 1 && wantedPage !== null
  return matched.map((f) => ({
    sha: f.sha,
    page: applyPage && wantedPage! <= Math.max(1, f.pageCount)
      ? wantedPage!
      : (f.pageCount === 1 ? 1 : null),
    why: `إشارة صريحة في الـBOQ: "${raw.slice(0, 60)}"`,
    rank: 2 as const,
  }))
}

// ─── semantic routing (one call for ALL rows) ───────────────────────────────

const ROUTE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      description: 'For every BOQ row: which indexed files/pages most likely contain its quantity/dimensions.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'candidates'],
        properties: {
          row: { type: 'number', description: 'The row `position` you are matching.' },
          candidates: {
            type: 'array',
            description: 'Up to 3, best first. Empty array when genuinely nothing in the catalog relates.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'page', 'why'],
              properties: {
                file: { type: 'number', description: 'The file # from the catalog.' },
                page: { type: ['number', 'null'], description: 'The specific page, or null when the whole file is the candidate.' },
                why: { type: 'string', description: 'One short reason (which anchor/summary matched).' },
              },
            },
          },
        },
      },
    },
  },
}

interface RawRoute {
  matches?: Array<{ row?: unknown; candidates?: Array<{ file?: unknown; page?: unknown; why?: unknown }> }>
}

/** Build the routing catalog: one compact block per file. Anchors give the
 *  model per-page hooks; the whole thing is capped so 250 files stay one call. */
function buildCatalog(files: IndexedFile[]): { text: string; truncated: boolean } {
  const blocks: string[] = []
  let budget = CATALOG_CHAR_CAP
  let truncated = false
  files.forEach((f, i) => {
    const head = `#${i + 1} ${f.name}${f.docNumber ? ` [${f.docNumber}]` : ''}${f.title ? ` — ${f.title}` : ''} (${f.bucket}, ${f.kind}, ${f.pageCount} صفحة${f.partialToc ? '، فهرس جزئي' : ''}${f.error ? '، خطأ: ' + f.error : ''})`
    const anchors = f.pages
      .filter((p) => p.anchor && !p.anchor.startsWith('(صفحة ممسوحة'))
      .slice(0, 14)
      .map((p) => `  ص${p.page}: ${p.anchor}`)
    let block = [head, ...anchors].join('\n')
    if (block.length > budget) {
      block = head // page anchors dropped, file-level entry kept
      truncated = true
    }
    if (block.length <= budget) {
      blocks.push(block)
      budget -= block.length + 1
    } else {
      truncated = true
    }
  })
  return { text: blocks.join('\n'), truncated }
}

export interface RouteOutput {
  byRow: Map<number, Candidate[]>
  catalogTruncated: boolean
}

export async function routeRows(rows: RouterRow[], files: IndexedFile[]): Promise<RouteOutput> {
  const byRow = new Map<number, Candidate[]>()
  if (rows.length === 0 || files.length === 0) return { byRow, catalogTruncated: false }

  const { text: catalog, truncated } = buildCatalog(files)
  const rowsText = rows
    .map((r) => {
      const bits = [
        `صف ${r.position}: ${r.description}`,
        r.details ? `تفاصيل: ${r.details.slice(0, 120)}` : '',
        r.quantityStated ? `كمية الـBOQ: ${r.quantity} ${r.unit} (تحقّق منها)` : `بلا كمية (${r.unit})`,
        r.referenceHint ? `إشارة: ${r.referenceHint.slice(0, 80)}` : '',
      ].filter(Boolean)
      return bits.join(' | ')
    })
    .join('\n')

  const provider = await getProvider()
  const parsed = await withTimeout(
    provider.generateStructured<RawRoute>({
      systemInstruction: `أنت موجّه مستندات في شركة رخام سعودية. أمامك صفوف BOQ وفهرس ملفات المشروع (أسماء، أرقام لوحات، وملخص كل صفحة). مهمتك فقط: لكل صف، حدّد أي ملف/صفحة يُرجّح أن تحتوي كميته أو أبعاده — لا تستخرج أرقاماً هنا.

قواعد:
- الفهرس ثنائي اللغة: "بلاط رخام لوبي" قد يجيب على "Lobby finishes schedule" — طابق بالمعنى لا بالحروف.
- جداول التشطيبات/الكميات وملخصات المساحات هي المرشح الأول للكميات؛ اللوحات المعمارية للمقاسات.
- صف كميته مذكورة في الـBOQ ما زال يحتاج مرشحاً للتحقق (الرسومات تتفوق عند التعارض) — أعطه أفضل مرشح إن وُجد.
- لا تخترع صفحات: التزم بأرقام الصفحات الظاهرة في الفهرس، أو null للملف كاملاً.
- مرشح واحد جيد أفضل من ثلاثة ضعيفة. ولا مرشح إطلاقاً أفضل من مرشح مختلق.`,
      files: [],
      userText: `## صفوف الـBOQ\n${rowsText}\n\n## فهرس الملفات\n${catalog}\n\nطابق كل صف بمرشحيه. JSON فقط.`,
      schema: ROUTE_SCHEMA,
      schemaName: 'boq_routing',
      temperature: 0.1,
    }),
    AI_CALL_TIMEOUT_MS,
    'توجيه الصفوف',
  )

  for (const m of parsed.matches || []) {
    const pos = Number(m?.row)
    if (!Number.isFinite(pos)) continue
    const cands: Candidate[] = []
    for (const c of (m?.candidates || []).slice(0, MAX_CANDIDATES_PER_ROW)) {
      const fi = Number(c?.file) - 1
      if (!Number.isFinite(fi) || fi < 0 || fi >= files.length) continue
      const f = files[fi]
      const pRaw = c?.page
      const page =
        pRaw === null || pRaw === undefined
          ? null
          : Number.isFinite(Number(pRaw)) && Number(pRaw) >= 1 && Number(pRaw) <= Math.max(1, f.pageCount)
            ? Number(pRaw)
            : null
      cands.push({ sha: f.sha, page, why: String(c?.why || '').slice(0, 120), rank: 1 })
    }
    if (cands.length > 0) byRow.set(pos, cands)
  }
  return { byRow, catalogTruncated: truncated }
}

// ─── reading (grouped per page) ─────────────────────────────────────────────

const READ_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      description: 'One entry per requested row.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'found', 'value', 'unit', 'quote'],
        properties: {
          row: { type: 'number' },
          found: { type: 'boolean', description: 'true ONLY if a number for THIS item is actually present here.' },
          value: { type: 'number', description: 'The number as written. 0 when found=false.' },
          unit: { type: 'string', description: 'The unit as written next to the number (m2, lm, no., …). Empty when found=false.' },
          quote: { type: 'string', description: 'VERBATIM: the exact text fragment containing the number, copied character-for-character (e.g. "Lobby ... 412 m2"). Empty when found=false.' },
        },
      },
    },
  },
}

interface RawRead {
  results?: Array<{ row?: unknown; found?: unknown; value?: unknown; unit?: unknown; quote?: unknown }>
}

export interface ReadGroup {
  file: IndexedFile
  page: number | null
  rows: RouterRow[]
}

function rowsAsk(rows: RouterRow[]): string {
  return rows
    .map((r) => `صف ${r.position}: ${r.description}${r.details ? ` (${r.details.slice(0, 90)})` : ''} — الوحدة المتوقعة: ${r.unit}`)
    .join('\n')
}

function parseRead(parsed: RawRead, allowed: Set<number>): Map<number, { value: number; unit: string; quote: string }> {
  const out = new Map<number, { value: number; unit: string; quote: string }>()
  for (const r of parsed.results || []) {
    const pos = Number(r?.row)
    if (!allowed.has(pos)) continue
    if (r?.found !== true) continue
    const value = Number(r?.value)
    if (!Number.isFinite(value) || value <= 0) continue
    const quote = String(r?.quote || '').trim()
    if (!quote) continue
    out.set(pos, { value, unit: String(r?.unit || '').trim().slice(0, 20), quote: quote.slice(0, 300) })
  }
  return out
}

/** TEXT page: read + verify each quote against the page text. A value whose
 *  quote does not occur verbatim is REJECTED — that's the hallucination gate. */
export async function readTextPage(group: ReadGroup): Promise<Resolution[]> {
  const page = group.page ?? 1
  const pageObj = group.file.pages.find((p) => p.page === page)
  const pageText = (pageObj?.text || '').slice(0, PAGE_TEXT_CAP)
  if (!pageText) return []

  const provider = await getProvider()
  const parsed = await withTimeout(
    provider.generateStructured<RawRead>({
      systemInstruction:
        'أنت قارئ جداول كميات دقيق. أمامك نص صفحة واحدة من مستند مشروع، وقائمة بنود مطلوب إيجاد كمياتها/مقاساتها في هذه الصفحة تحديداً. لكل بند: إن وُجد رقم يخصه فعلاً في النص، أرجعه مع اقتباس حرفي (انسخ الجزء الذي يحوي الرقم كما هو تماماً). إن لم يوجد فأرجع found=false — لا تخمّن أبداً، ولا تجب من معرفة عامة.',
      files: [],
      userText: `## البنود\n${rowsAsk(group.rows)}\n\n## نص الصفحة (${group.file.name} ص${page})\n${pageText}\n\nJSON فقط.`,
      schema: READ_SCHEMA,
      schemaName: 'page_read',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    `قراءة ${group.file.name} ص${page}`,
  )

  const allowed = new Set(group.rows.map((r) => r.position))
  const found = parseRead(parsed, allowed)
  const out: Resolution[] = []
  for (const [pos, r] of found) {
    // Hallucination gate: the VALUE (not just the quote string) must be a real
    // number on the page AND inside its own quote. See readingVerifies.
    if (!readingVerifies(pageText, r.quote, r.value)) continue
    out.push({
      position: pos, value: r.value, unit: r.unit, quote: r.quote,
      fileName: group.file.name, page, bucket: group.file.bucket,
      verified: 'quote', visual: false,
    })
  }
  return out
}

const VISUAL_READ_INSTRUCTION =
  'أنت قارئ مخططات وجداول ممسوحة. أمامك صفحة واحدة (صورة). اقرأ فقط الأرقام المكتوبة فعلاً: خلايا الجداول، والمساحات/الأطوال المكتوبة كنص على المخطط، وأسطر الأبعاد المُعلَّمة. ممنوع منعاً باتاً: القياس من الرسم، أو حساب مساحة من تظليل، أو استخدام مقياس الرسم — الصورة قد تكون مصغّرة والمقياس بلا معنى. لكل بند: إن ظهر رقم يخصه، أرجعه مع quote = النص الظاهر حوله كما تقرؤه (مثل "Lobby marble 412 m2"). إن لم يظهر فـfound=false — لا تخمّن.'

async function visualReadOnce(
  provider: Awaited<ReturnType<typeof getProvider>>,
  aiFile: AiFile,
  group: ReadGroup,
  label: string,
): Promise<Map<number, { value: number; unit: string; quote: string }>> {
  const parsed = await withTimeout(
    provider.generateStructured<RawRead>({
      systemInstruction: VISUAL_READ_INSTRUCTION,
      files: [aiFile],
      userText: `## البنود المطلوب إيجاد أرقامها في هذه الصفحة\n${rowsAsk(group.rows)}\n\nJSON فقط.`,
      schema: READ_SCHEMA,
      schemaName: 'visual_read',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    label,
  )
  return parseRead(parsed, new Set(group.rows.map((r) => r.position)))
}

/** VISUAL page (scan/photo/drawing): a number in pixels can't be indexOf-verified
 *  against text, so verification is TWO GENUINELY INDEPENDENT reads of the same
 *  page — neither told the other's answer — and a value is accepted only when
 *  both reads land on the same number (within tolerance). Anchoring the second
 *  call with the first's value (the old "confirm this?" approach) just made it
 *  agree; two blind reads that must match is a real check. Same call count. */
export async function readVisualPage(group: ReadGroup): Promise<Resolution[]> {
  const buf = await refetchBytes(group.file)
  const mime = mimeFromName(group.file.name)

  let aiFile: AiFile
  let pageLabel: number | null = group.page
  if (mime === 'application/pdf') {
    const page = group.page ?? 1
    const single = await extractPdfPageRange(buf, page, page)
    aiFile = { data: single.toString('base64'), mimeType: 'application/pdf', label: `${group.file.name} — صفحة ${page}` }
    pageLabel = page
  } else {
    aiFile = { data: buf.toString('base64'), mimeType: mime, label: group.file.name }
    pageLabel = 1
  }

  const provider = await getProvider()
  const readA = await visualReadOnce(provider, aiFile, group, `قراءة بصرية أ ${group.file.name}`)
  if (readA.size === 0) return [] // nothing to confirm — skip the second call, save tokens
  const readB = await visualReadOnce(provider, aiFile, group, `قراءة بصرية ب ${group.file.name}`)

  const out: Resolution[] = []
  for (const [pos, a] of readA) {
    const b = readB.get(pos)
    // Both blind reads must produce the SAME number for this row.
    if (!b || Math.abs(a.value - b.value) > 0.01) continue
    out.push({
      position: pos, value: a.value, unit: a.unit || b.unit, quote: a.quote,
      fileName: group.file.name, page: pageLabel, bucket: group.file.bucket,
      verified: 'double-read', visual: true,
    })
  }
  return out
}
