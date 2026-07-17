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

import * as XLSX from 'xlsx'
import { extractText, getDocumentProxy } from 'unpdf'
import { unzipSync } from 'fflate'
import type { AiFile } from './provider'

const EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp'])

// Below this much extracted text we treat a PDF as scanned/image-only and send
// it for vision instead of as (near-empty) text.
// A page with less than this is furniture — a title block, a stamp, a page
// number — not content. Judged PER PAGE; see extractPdfText for why the old
// document-wide total was the wrong question.
const MIN_PAGE_TEXT_CHARS = 80

// If fewer than this share of pages carry real text, treat the PDF as a scan
// and send it to vision instead. 0.7 keeps normal digital docs (which often
// have a blank divider or two) on the cheap text path, while a mixed
// cover+scan file — the case that was silently losing 99% of its content —
// correctly falls through to vision.
const MIN_TEXT_PAGE_RATIO = 0.7

export function extOf(name: string): string {
  return name.toLowerCase().split('?')[0].split('.').pop() || ''
}

export function mimeFromName(name: string): string {
  switch (extOf(name)) {
    case 'pdf': return 'application/pdf'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'xls': return 'application/vnd.ms-excel'
    case 'csv': return 'text/csv'
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

function excelBufferToCsv(buf: Buffer, originalName: string): string {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const csv = XLSX.utils.sheet_to_csv(ws, { strip: true, blankrows: false })
    parts.push(`## Sheet: ${name}\n${csv}`)
  }
  return `# Workbook: ${originalName}\n\n${parts.join('\n\n')}`
}

// Per-page text joined with "## Page N" markers, or null if the PDF has no
// meaningful extractable text (scanned).
async function extractPdfText(buf: Buffer): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: false })
    const pages = Array.isArray(text) ? text : [String(text)]

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
}

// Convert one file's bytes into an AiFile, or null when the format isn't
// something the model can read (video / unknown binary).
async function bytesToAiFile(buf: Buffer, name: string, label: string, opts: FetchOpts): Promise<AiFile | null> {
  if (VIDEO_EXTS.has(extOf(name))) return null

  const mime = mimeFromName(name)

  if (EXCEL_MIMES.has(mime)) {
    const csv = excelBufferToCsv(buf, name)
    return { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv', label }
  }

  if (mime === 'application/pdf') {
    if (!opts.visual) {
      const text = await extractPdfText(buf)
      if (text) return { data: Buffer.from(text, 'utf8').toString('base64'), mimeType: 'text/plain', label }
    }
    return { data: buf.toString('base64'), mimeType: 'application/pdf', label }
  }

  if (mime.startsWith('image/')) {
    return { data: buf.toString('base64'), mimeType: mime, label }
  }

  if (mime === 'text/csv' || mime === 'text/plain') {
    return { data: buf.toString('base64'), mimeType: mime, label }
  }

  // docx / unknown binary → can't read reliably; skip rather than send garbage.
  return null
}

// Fetch one URL and return 1..N AiFiles. A ZIP expands into many; an unreadable
// file yields []. `label` is the caption the model sees before each file.
export async function fetchAiFiles(url: string, label: string, opts: FetchOpts = {}): Promise<AiFile[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const name = fileNameFromUrl(url)

  // ZIP → unzip and process each entry.
  if (mimeFromName(name) === 'application/zip') {
    const out: AiFile[] = []
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(new Uint8Array(buf))
    } catch {
      return [] // corrupt / unsupported zip — skip rather than crash the run
    }
    for (const [entryPath, data] of Object.entries(entries)) {
      if (entryPath.endsWith('/')) continue                       // directory
      if (entryPath.includes('__MACOSX')) continue                // mac resource forks
      const base = entryPath.split('/').pop() || entryPath
      if (!base || base.startsWith('.')) continue                 // dotfiles (.DS_Store …)
      const af = await bytesToAiFile(Buffer.from(data), base, `${label} › ${base}`, opts)
      if (af) out.push(af)
    }
    return out
  }

  const single = await bytesToAiFile(buf, name, label, opts)
  return single ? [single] : []
}
