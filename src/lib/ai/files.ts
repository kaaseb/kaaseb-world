// Shared attachment loader for AI requests.
//
// Goal: turn ANY upload (up to ~100 files, any format except video) into the
// representation the model reads best, and EXPAND containers:
//
//   • ZIP archives         → unzipped; every entry processed recursively (a
//                            single .zip can carry the bulk of a big project).
//   • Excel/CSV            → flattened to CSV text (SheetJS).
//   • Digital (text) PDFs  → text per page (unpdf) — cheap + exact; page markers
//                            let the model cite "page 3".
//   • Scanned PDFs         → kept as the PDF so the model reads them visually.
//   • Drawings (visual)    → kept as the PDF/image — a plan's meaning is its
//                            geometry, not its text.
//   • Images               → sent as-is for vision.
//   • Video / unknown      → skipped (never sent — the model can't read them and
//                            it would just waste tokens or error).
//
// Output is provider-agnostic (base64 + mimeType + label); each provider then
// encodes it (input_text / input_image / input_file).

import { heavy } from '@/lib/heavy'
import { fetchAppOwned } from '@/lib/s3'
import { sniff, decodeText, unreadableReason } from '@/lib/files/sniff'
import { archiveFiles, memberName, docxText } from '@/lib/files/read'
import type { AiFile } from './provider'


// Below this much extracted text we treat a PDF as scanned/image-only and send
// it for vision instead of as (near-empty) text.
// A page with less than this is furniture — a title block, a stamp, a page
// number — not content. Judged PER PAGE; see extractPdfText for why the old
// document-wide total was the wrong question.
const MIN_PAGE_TEXT_CHARS = 80

// If fewer than this share of pages carry real text, treat the PDF as a scan
// and send it to vision instead.
//
// Deliberately conservative at 0.5 — only flip when the MAJORITY of the file is
// unreadable as text. A healthy digital spec routinely has blank section
// dividers or an image-only appendix, and pushing those to vision would make a
// working file slower and dearer for no gain. The failure this exists to catch
// isn't subtle: the real case was 3 text pages out of 403 (0.7%), nowhere near
// this line. When in doubt, leave the current behaviour alone.
const MIN_TEXT_PAGE_RATIO = 0.5

export function extOf(name: string): string {
  return name.toLowerCase().split('?')[0].split('.').pop() || ''
}

export function mimeFromName(name: string): string {
  switch (extOf(name)) {
    case 'pdf': return 'application/pdf'
    case 'xlsx':
    case 'xlsm':
    case 'xlsb':
    case 'ods': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'xls': return 'application/vnd.ms-excel'
    case 'csv':
    case 'tsv': return 'text/csv'
    case 'txt': return 'text/plain'
    case 'zip': return 'application/zip'
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'application/octet-stream'
  }
}

function fileNameFromUrl(url: string): string {
  return decodeURIComponent(url.split('/').pop() || 'file').split('?')[0]
}

async function excelBufferToCsv(buf: Buffer, originalName: string): Promise<string> {
  // Parsed in the worker pool — SheetJS is synchronous CPU and a big BOQ used
  // to stall every request on the server while it ran.
  const { sheets } = await heavy.xlsxSheets(buf)
  const parts = sheets.map(({ name, csv }) => `## Sheet: ${name}\n${csv}`)
  return `# Workbook: ${originalName}\n\n${parts.join('\n\n')}`
}

// Per-page text joined with "## Page N" markers, or null if the PDF has no
// meaningful extractable text (scanned).
async function extractPdfText(buf: Buffer): Promise<string | null> {
  try {
    const { pages } = await heavy.pdfText(buf)
    if (!pages) return null

    // Judge EACH PAGE, not the document total.
    //
    // This used to be `total = sum(all pages) < MIN_PDF_TEXT_CHARS`, which is
    // the wrong question for the mixed PDFs this app actually receives. A real
    // Sold.pdf is 3 digital cover pages + 400 SCANNED table pages: the covers
    // alone clear an 80-char document threshold, so the whole file took the
    // text path and pages 4-400 came back as "## Page 40" followed by nothing.
    // The model then received a document that looked complete and was 99% empty,
    // and answered `quantity: 0` for a number that was sitting right there in
    // the pixels. Nothing anywhere reported a problem.
    //
    // Now: if a meaningful share of pages is empty, the file is (at least
    // partly) a scan — return null so the caller sends the real PDF and lets
    // vision read it. Losing cheap text on a mixed file is a far smaller cost
    // than silently dropping its contents.
    const textish = pages.filter((p) => (p || '').trim().length >= MIN_PAGE_TEXT_CHARS)
    if (textish.length === 0) return null
    if (textish.length < pages.length * MIN_TEXT_PAGE_RATIO) return null

    return pages.map((p, i) => `## Page ${i + 1}\n${(p || '').trim()}`).join('\n\n')
  } catch {
    return null
  }
}

export interface FetchOpts {
  // Force the visual representation (send the PDF/image as-is, never text).
  // Use for drawings/plans where geometry carries the meaning.
  visual?: boolean
  /** The file's ORIGINAL name. The S3 key cannot be trusted for this: anything
   *  outside a short extension list is stored as ".bin" (xlsm, zip, rar…). */
  name?: string
  /** Collects, per file, WHY something could not be read — shown to the user. */
  notes?: string[]
}

// Image types the vision models accept as-is.
const VISION_IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// Convert one file's bytes into an AiFile, or null when it cannot be read — in
// which case the reason is pushed to opts.notes. The type is decided from the
// BYTES (see lib/files/sniff): a CSV named .txt, an HTML table named .xls, an
// .xlsm stored as .bin are all read for what they are.
async function bytesToAiFile(buf: Buffer, name: string, label: string, opts: FetchOpts): Promise<AiFile | null> {
  const s = sniff(buf, name)
  const text = (t: string, mimeType: string): AiFile => ({ data: Buffer.from(t, 'utf8').toString('base64'), mimeType, label })

  switch (s.kind) {
    case 'spreadsheet': {
      try {
        return text(await excelBufferToCsv(buf, name), 'text/csv')
      } catch (e) {
        const m = e instanceof Error ? e.message : ''
        opts.notes?.push(`${name}: ${/password|encrypt/i.test(m) ? 'محمي بكلمة مرور — احفظه بدون كلمة مرور ثم ارفعه' : `تعذّر فتح ملف الإكسل (${m || 'تالف'})`}`)
        return null
      }
    }
    case 'delimited':
      // Decoded here (UTF-8 / UTF-16 / Windows-1256) so Arabic survives.
      return text(decodeText(buf), 'text/csv')
    case 'text':
      return text(decodeText(buf), 'text/plain')
    case 'pdf': {
      if (!opts.visual) {
        const t = await extractPdfText(buf)
        if (t) return text(t, 'text/plain')
      }
      return { data: buf.toString('base64'), mimeType: 'application/pdf', label }
    }
    case 'image':
      if (VISION_IMAGE.has(s.mime)) return { data: buf.toString('base64'), mimeType: s.mime, label }
      opts.notes?.push(`${name}: صيغة صورة غير مدعومة (${s.mime}) — احفظها PNG أو JPG`)
      return null
    case 'docx': {
      const t = await docxText(buf)
      if (t) return text(`# Document: ${name}\n\n${t}`, 'text/plain')
      opts.notes?.push(`${name}: ملف Word فارغ أو غير مقروء`)
      return null
    }
    default:
      opts.notes?.push(`${name}: ${unreadableReason(s.kind) || 'لا يُقرأ'}`)
      return null
  }
}

// Fetch one URL and return 1..N AiFiles. An archive (ZIP / RAR, one nested
// level) expands into many; an unreadable file yields [] with the reason in
// opts.notes. `label` is the caption the model sees before each file.
export async function fetchAiFiles(url: string, label: string, opts: FetchOpts = {}): Promise<AiFile[]> {
  // SSRF guard: boq_url / spec / drawing / other URLs arrive from a request body.
  // Only our own S3/CDN uploads may be fetched server-side — never an arbitrary
  // or internal URL. Protects both the router (phase 1 BOQ) and the old Tannoor
  // engine, which share this loader.
  const res = await fetchAppOwned(url)
  if (!res.ok) throw new Error(`تعذّر تحميل الملف من التخزين (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0) { opts.notes?.push(`${opts.name || 'ملف'}: الملف فارغ (0 بايت) — أعد رفعه`); return [] }
  const name = opts.name || fileNameFromUrl(url)

  const kind = sniff(buf, name).kind
  if (kind === 'zip' || kind === 'rar') {
    const { files, notes } = await archiveFiles(buf, name)
    opts.notes?.push(...notes)
    const out: AiFile[] = []
    for (const f of files) {
      const base = memberName(f.path)
      const af = await bytesToAiFile(f.data, base, `${label} › ${base}`, opts)
      if (af) out.push(af)
    }
    return out
  }

  const single = await bytesToAiFile(buf, name, label, opts)
  return single ? [single] : []
}
