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
  normalizeText, quoteVerifies, withTimeout,
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

/** Resolve a row's free-text hint against the indexed files by NAME/doc-number.
 *  Stem comparison, so "Sold.pdf", "sold" and "Sold_rev2.pdf" meet. */
export function resolveExplicitHint(hint: string, files: IndexedFile[]): Candidate[] {
  const raw = (hint || '').trim()
  if (!raw) return []
  const normHint = normalizeText(raw)
  if (!normHint) return []
  const wantedPage = pageFromHint(raw)

  const out: Candidate[] = []
  for (const f of files) {
    const stem = normalizeText(f.name.replace(/\.[a-z0-9]+$/i, ''))
    const doc = f.docNumber ? normalizeText(f.docNumber) : ''
    const named =
      (stem.length >= 3 && normHint.includes(stem)) ||
      (doc.length >= 2 && normHint.includes(doc)) ||
      stem.split(' ').some((w) => w.length >= 4 && normHint.includes(w))
    if (!named) continue
    const page = wantedPage && wantedPage <= Math.max(1, f.pageCount) ? wantedPage : null
    out.push({
      sha: f.sha,
      page: page ?? (f.pageCount === 1 ? 1 : null),
      why: `إشارة صريحة في الـBOQ: "${raw.slice(0, 60)}"`,
      rank: 2,
    })
  }
  return out
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

const CONFIRM_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row', 'confirmed'],
        properties: {
          row: { type: 'number' },
          confirmed: { type: 'boolean', description: 'true ONLY if the page visibly shows exactly this value for this item.' },
        },
      },
    },
  },
}

interface RawConfirm { results?: Array<{ row?: unknown; confirmed?: unknown }> }

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
    if (!quoteVerifies(pageText, r.quote)) continue // hallucination gate
    out.push({
      position: pos, value: r.value, unit: r.unit, quote: r.quote,
      fileName: group.file.name, page, verified: 'quote', visual: false,
    })
  }
  return out
}

/** VISUAL page (scan/photo/drawing): extract the single page, read numbers with
 *  vision (tables + written labels ONLY), then a second independent vision call
 *  must confirm each value before it is accepted. */
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

  const readInstruction =
    'أنت قارئ مخططات وجداول ممسوحة. أمامك صفحة واحدة (صورة). اقرأ فقط الأرقام المكتوبة فعلاً: خلايا الجداول، والمساحات/الأطوال المكتوبة كنص على المخطط، وأسطر الأبعاد المُعلَّمة. ممنوع منعاً باتاً: القياس من الرسم، أو حساب مساحة من تظليل، أو استخدام مقياس الرسم — الصورة قد تكون مصغّرة والمقياس بلا معنى. لكل بند: إن ظهر رقم يخصه، أرجعه مع quote = النص الظاهر حوله كما تقرؤه (مثل "Lobby marble 412 m2"). إن لم يظهر فـfound=false — لا تخمّن.'

  const provider = await getProvider()
  const parsed = await withTimeout(
    provider.generateStructured<RawRead>({
      systemInstruction: readInstruction,
      files: [aiFile],
      userText: `## البنود المطلوب إيجاد أرقامها في هذه الصفحة\n${rowsAsk(group.rows)}\n\nJSON فقط.`,
      schema: READ_SCHEMA,
      schemaName: 'visual_read',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    `قراءة بصرية ${group.file.name}`,
  )

  const allowed = new Set(group.rows.map((r) => r.position))
  const found = parseRead(parsed, allowed)
  if (found.size === 0) return []

  // Double-read: pixels can't be indexOf'd, so verification is an independent
  // second look that must re-see each claimed value. Disagreement = rejection —
  // a dropped true value costs a manual check; a passed false one costs money.
  const claims = [...found.entries()]
    .map(([pos, r]) => `صف ${pos}: القيمة المدّعاة ${r.value} ${r.unit} — سياقها "${r.quote.slice(0, 80)}"`)
    .join('\n')
  const confirm = await withTimeout(
    provider.generateStructured<RawConfirm>({
      systemInstruction:
        'أنت مدقق مستقل. انظر إلى الصفحة (الصورة) بعينين جديدتين وتحقق من كل قيمة مدّعاة: هل تظهر فعلاً بهذا الرقم لهذا البند في هذه الصفحة؟ كن متشدداً — عند أدنى شك أجب confirmed=false.',
      files: [aiFile],
      userText: `## القيم المدّعاة\n${claims}\n\nتحقق منها واحدة واحدة. JSON فقط.`,
      schema: CONFIRM_SCHEMA,
      schemaName: 'visual_confirm',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    `تدقيق بصري ${group.file.name}`,
  )

  const confirmed = new Set<number>()
  for (const r of confirm.results || []) {
    if (r?.confirmed === true && Number.isFinite(Number(r?.row))) confirmed.add(Number(r.row))
  }

  const out: Resolution[] = []
  for (const [pos, r] of found) {
    if (!confirmed.has(pos)) continue
    out.push({
      position: pos, value: r.value, unit: r.unit, quote: r.quote,
      fileName: group.file.name, page: pageLabel, verified: 'double-read', visual: true,
    })
  }
  return out
}
