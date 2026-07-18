// BOQ Router — phase 2: index every attachment ONCE, keyed by content hash.
//
// The index is what makes routing possible: a compact, per-page map of what
// each of the ~200 files contains. Three rules keep it cheap and honest:
//
//   1. DIGITAL text is extracted deterministically (unpdf / SheetJS) — zero
//      tokens. Most spec PDFs and every Excel cost nothing to index.
//   2. SCANNED/IMAGE files (the user's hard case — "الأرقام صور مو نصوص") get
//      ONE capped vision pass that reads the title block and writes a one-line
//      summary per page. Reading actual numbers happens later, per routed page.
//   3. Everything is cached in S3 under sha256(bytes) + INDEX_VERSION. Same
//      bytes = same index forever, across re-runs, re-uploads and projects.
//      Failures are NEVER cached — a 503 is not a property of the file.

import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { readJson, writeJson, fetchAppOwned } from '@/lib/s3'
import { getProvider } from '@/lib/ai'
import type { AiFile, JsonSchema } from '@/lib/ai/provider'
import { extOf, mimeFromName } from '@/lib/ai/files'
import {
  INDEX_VERSION, VISION_TOC_MAX_PAGES, MIN_PAGE_TEXT_CHARS, AI_CALL_TIMEOUT_MS,
  sha256, withTimeout,
  type IndexedFile, type IndexedPage, type SourceRef,
} from './core'

const cacheKey = (sha: string) => `app-data/boq-index/v${INDEX_VERSION}-${sha}.json`

const PAGE_ANCHOR_CHARS = 110
const SHEET_TEXT_CAP = 18_000
const MAX_FILE_BYTES = 80 * 1024 * 1024 // refuse to buffer anything bigger

// ─── fetching (zip-aware) ───────────────────────────────────────────────────

export interface RawSource {
  ref: SourceRef
  buf: Buffer
}

/**
 * Fetch one uploaded URL and expand it into raw sources. A ZIP yields one
 * RawSource per entry, each with its own identity (`zipEntry`) — so a zipped
 * drawing gets its own content hash and its own index entry, exactly like a
 * loose upload of the same bytes would.
 */
export async function fetchSources(
  url: string,
  name: string,
  bucket: SourceRef['bucket'],
): Promise<RawSource[]> {
  // SSRF guard: only our own S3/CDN URLs are ever fetched server-side.
  const res = await fetchAppOwned(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error(`الملف أكبر من الحد (${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`)

  if (mimeFromName(name) !== 'application/zip') {
    return [{ ref: { url, name, bucket }, buf }]
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(buf))
  } catch {
    throw new Error('ملف ZIP تالف')
  }
  const out: RawSource[] = []
  for (const [entryPath, data] of Object.entries(entries)) {
    if (entryPath.endsWith('/') || entryPath.includes('__MACOSX')) continue
    const base = entryPath.split('/').pop() || entryPath
    if (!base || base.startsWith('.')) continue
    out.push({ ref: { url, name: base, bucket, zipEntry: entryPath }, buf: Buffer.from(data) })
  }
  return out
}

/** Re-fetch the bytes behind an already-indexed file (read phase needs them for
 *  visual pages). Verifies the hash so a silently-overwritten stable S3 key can
 *  never feed us different bytes under a cached identity. */
export async function refetchBytes(file: IndexedFile): Promise<Buffer> {
  const res = await fetchAppOwned(file.source.url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  let buf = Buffer.from(await res.arrayBuffer())
  if (file.source.zipEntry) {
    const entries = unzipSync(new Uint8Array(buf))
    const data = entries[file.source.zipEntry]
    if (!data) throw new Error('اختفى الملف من داخل الـZIP')
    buf = Buffer.from(data)
  }
  if (sha256(buf) !== file.sha) {
    throw new Error('تغيّر محتوى الملف منذ الفهرسة — أعد المعالجة')
  }
  return buf
}

// ─── deterministic extraction ───────────────────────────────────────────────

function anchorOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim().slice(0, PAGE_ANCHOR_CHARS)
  // Flag pages that look like they carry quantities — a strong routing signal
  // the router model can use, produced for free.
  const qtyish = /\d[\d,.]*\s*(m2|m²|م2|lm|m\b|متر|pcs|عدد|no\.|sqm|كمية|qty)/i.test(text)
  return qtyish ? `${flat} [يحوي أرقام كميات]` : flat
}

async function extractPdfPages(buf: Buffer): Promise<{ pages: IndexedPage[]; pageCount: number } | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: false })
    const raw = Array.isArray(text) ? text : [String(text)]
    const pages: IndexedPage[] = raw.map((p, i) => {
      const t = (p || '').trim()
      // Per-page judgement (the Sold.pdf lesson): a page under the threshold is
      // pixels — mark it visual so the read phase KNOWS to use vision on it.
      if (t.length < MIN_PAGE_TEXT_CHARS) {
        return { page: i + 1, text: null, anchor: '(صفحة ممسوحة — تُقرأ بصرياً)' }
      }
      return { page: i + 1, text: t, anchor: anchorOf(t) }
    })
    return { pages, pageCount: pages.length }
  } catch {
    return null
  }
}

async function pdfPageCount(buf: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
    return doc.getPageCount()
  } catch {
    return 0
  }
}

/**
 * Extract ONE page (or a small range) of a PDF as a standalone PDF. This is how
 * "send only page 40" works: pdf-lib copies the page with its resources (for a
 * scanned page that's the embedded image), so the model sees exactly one page
 * instead of a 400-page document.
 */
export async function extractPdfPageRange(buf: Buffer, from1: number, to1: number): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
  const out = await PDFDocument.create()
  const count = src.getPageCount()
  const a = Math.min(Math.max(1, from1), count) - 1
  const b = Math.min(Math.max(from1, to1), count) - 1
  const idx = Array.from({ length: b - a + 1 }, (_, i) => a + i)
  const copied = await out.copyPages(src, idx)
  for (const p of copied) out.addPage(p)
  return Buffer.from(await out.save())
}

// ─── vision TOC (scanned files only) ────────────────────────────────────────

const TOC_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_number', 'title', 'pages'],
  properties: {
    doc_number: { type: 'string', description: 'Drawing/sheet number from the title block, e.g. "A-301", "S-12". Empty string if none is visible.' },
    title: { type: 'string', description: 'Document title as printed (Arabic or English). Empty string if unreadable.' },
    pages: {
      type: 'array',
      description: 'One entry PER PAGE, in order, describing what is visibly on it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'summary'],
        properties: {
          page: { type: 'number' },
          summary: { type: 'string', description: 'One line: what this page shows (plan of what? schedule of what? table columns?). Mention visible tables/quantities. Do NOT invent.' },
        },
      },
    },
  },
}

interface RawToc { doc_number?: unknown; title?: unknown; pages?: unknown }

async function visionToc(
  aiData: Buffer,
  mimeType: string,
  name: string,
): Promise<{ docNumber: string | null; title: string | null; pages: Map<number, string> }> {
  const provider = await getProvider()
  const file: AiFile = { data: aiData.toString('base64'), mimeType, label: `ملف ممسوح: ${name}` }
  const parsed = await withTimeout(
    provider.generateStructured<RawToc>({
      systemInstruction:
        'أنت مفهرس مستندات هندسية لشركة رخام. أمامك ملف ممسوح (صور). اكتب رقم اللوحة/المستند من كرتوش العنوان إن وُجد، وعنوانه، وسطراً واحداً لكل صفحة يصف ما يظهر فيها (مخطط ماذا؟ جدول ماذا؟ أعمدة الجدول؟). اقرأ فقط ما هو مكتوب فعلاً — لا تخمّن ولا تخترع، ولا تقس شيئاً من الرسم.',
      files: [file],
      userText: 'افهرس هذا الملف صفحةً صفحة. JSON فقط.',
      schema: TOC_SCHEMA,
      schemaName: 'visual_toc',
      temperature: 0.1,
    }),
    AI_CALL_TIMEOUT_MS,
    `فهرسة ${name}`,
  )

  const pages = new Map<number, string>()
  if (Array.isArray(parsed.pages)) {
    for (const p of parsed.pages) {
      if (!p || typeof p !== 'object') continue
      const n = Number((p as Record<string, unknown>).page)
      const s = String((p as Record<string, unknown>).summary || '').trim().slice(0, 160)
      if (Number.isFinite(n) && n >= 1 && s) pages.set(n, s)
    }
  }
  const docNumber = String(parsed.doc_number || '').trim().slice(0, 40) || null
  const title = String(parsed.title || '').trim().slice(0, 120) || null
  return { docNumber, title, pages }
}

// ─── the indexer ────────────────────────────────────────────────────────────

/**
 * Index one raw source. Returns the IndexedFile and whether it was served from
 * cache. Never throws for content problems — an unreadable file becomes an
 * entry that says WHY, because "we searched everything" must never be a lie.
 */
export async function indexSource(raw: RawSource): Promise<{ file: IndexedFile; cached: boolean }> {
  const sha = sha256(raw.buf)

  const cached = await readJson<IndexedFile | null>(cacheKey(sha), null)
  if (cached && cached.sha === sha) {
    // The cache stores the index under the CONTENT hash, but this project may
    // reference the same bytes from a different URL/zip — repoint the source.
    return { file: { ...cached, name: raw.ref.name, bucket: raw.ref.bucket, source: raw.ref }, cached: true }
  }

  const base: IndexedFile = {
    sha,
    name: raw.ref.name,
    bucket: raw.ref.bucket,
    source: raw.ref,
    kind: 'unreadable',
    pageCount: 0,
    pages: [],
    docNumber: null,
    title: null,
    partialToc: false,
    bytes: raw.buf.byteLength,
    error: null,
  }

  const ext = extOf(raw.ref.name)
  const mime = mimeFromName(raw.ref.name)

  // Excel / CSV / TXT → sheets & text are "pages", free.
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(raw.buf, { type: 'buffer' })
      const pages: IndexedPage[] = wb.SheetNames.map((sheet, i) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet], { strip: true, blankrows: false }).slice(0, SHEET_TEXT_CAP)
        const text = `## Sheet: ${sheet}\n${csv}`
        return { page: i + 1, text, anchor: `ورقة "${sheet}": ${anchorOf(csv)}` }
      })
      const file: IndexedFile = { ...base, kind: 'text', pages, pageCount: pages.length }
      await writeJson(cacheKey(sha), file)
      return { file, cached: false }
    } catch {
      return { file: { ...base, error: 'ملف إكسل تالف' }, cached: false }
    }
  }

  if (mime === 'text/csv' || mime === 'text/plain') {
    const text = raw.buf.toString('utf8').slice(0, SHEET_TEXT_CAP)
    const file: IndexedFile = {
      ...base, kind: 'text', pageCount: 1,
      pages: [{ page: 1, text, anchor: anchorOf(text) }],
    }
    await writeJson(cacheKey(sha), file)
    return { file, cached: false }
  }

  // Images → single visual "page" + one TOC line via vision.
  if (mime.startsWith('image/')) {
    try {
      const toc = await visionToc(raw.buf, mime, raw.ref.name)
      const summary = toc.pages.get(1) || toc.title || '(صورة — تُقرأ بصرياً)'
      const file: IndexedFile = {
        ...base, kind: 'visual', pageCount: 1,
        pages: [{ page: 1, text: null, anchor: summary }],
        docNumber: toc.docNumber, title: toc.title,
      }
      await writeJson(cacheKey(sha), file)
      return { file, cached: false }
    } catch (e) {
      // TOC failed (model/net) — return usable-but-uncached so the next run
      // retries instead of freezing the failure forever.
      return {
        file: {
          ...base, kind: 'visual', pageCount: 1,
          pages: [{ page: 1, text: null, anchor: '(صورة — تُقرأ بصرياً)' }],
          error: e instanceof Error ? e.message : 'فشل الفهرس البصري',
        },
        cached: false,
      }
    }
  }

  if (mime === 'application/pdf') {
    const extracted = await extractPdfPages(raw.buf)
    const pageCount = extracted?.pageCount || (await pdfPageCount(raw.buf))
    if (pageCount === 0) return { file: { ...base, error: 'PDF غير قابل للقراءة' }, cached: false }

    const textPages = extracted ? extracted.pages.filter((p) => p.text !== null).length : 0

    // Fully/mostly digital → free text index, cache immediately.
    if (extracted && textPages === extracted.pageCount) {
      const file: IndexedFile = { ...base, kind: 'text', pages: extracted.pages, pageCount }
      await writeJson(cacheKey(sha), file)
      return { file, cached: false }
    }

    // Mixed: keep the free text pages; scanned pages stay visual with a generic
    // anchor (they're still routable via explicit hints and readable by vision).
    if (extracted && textPages > 0) {
      const file: IndexedFile = { ...base, kind: 'mixed', pages: extracted.pages, pageCount }
      await writeJson(cacheKey(sha), file)
      return { file, cached: false }
    }

    // Entirely scanned (drawings, scanned schedules) → capped vision TOC.
    const tocPageLimit = Math.min(pageCount, VISION_TOC_MAX_PAGES)
    try {
      const slice = pageCount > VISION_TOC_MAX_PAGES
        ? await extractPdfPageRange(raw.buf, 1, tocPageLimit)
        : raw.buf
      const toc = await visionToc(slice, 'application/pdf', raw.ref.name)
      const pages: IndexedPage[] = Array.from({ length: pageCount }, (_, i) => ({
        page: i + 1,
        text: null,
        anchor: toc.pages.get(i + 1) || '(صفحة ممسوحة — تُقرأ بصرياً)',
      }))
      const file: IndexedFile = {
        ...base, kind: 'visual', pages, pageCount,
        docNumber: toc.docNumber, title: toc.title,
        partialToc: pageCount > VISION_TOC_MAX_PAGES,
      }
      await writeJson(cacheKey(sha), file)
      return { file, cached: false }
    } catch (e) {
      const pages: IndexedPage[] = Array.from({ length: pageCount }, (_, i) => ({
        page: i + 1, text: null, anchor: '(صفحة ممسوحة — تُقرأ بصرياً)',
      }))
      return {
        file: {
          ...base, kind: 'visual', pages, pageCount,
          error: e instanceof Error ? e.message : 'فشل الفهرس البصري',
        },
        cached: false,
      }
    }
  }

  // docx & friends — honestly unreadable.
  return { file: { ...base, error: `صيغة غير مقروءة (${ext || 'غير معروفة'})` }, cached: false }
}
