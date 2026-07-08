// Server-side PDF builder for Pre-qualifications.
//
// Final packet order:
//   [ cover file ]  →  [ auto Table of Contents ]  →  [ chosen documents ]  →  [ back file ]
//
// The cover + back are fixed template files (PDF or image, 1+ pages) the admin
// uploads once. The TOC is generated from the chosen documents — each entry is
// the document name + the page it starts on (page 1 = first document; the
// cover/TOC are front matter). The TOC is rendered as HTML→PDF (Puppeteer) so
// Arabic shapes correctly; everything else is merged with pdf-lib. The
// signature/seal stamp lands only on the DOCUMENT pages, not the templates.

import { PDFDocument, PDFImage } from 'pdf-lib'
import { renderHtmlToPdf } from '@/lib/html-pdf'

export interface PreQualDoc {
  url: string
  name_en: string | null
  name_ar: string | null
}

export interface PreQualBuildInput {
  documents: PreQualDoc[]
  coverUrl?: string | null
  backUrl?: string | null
  tocTitle?: { ar: string; en: string }
}

async function fetchBuffer(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
}

// Append a PDF (copy pages as-is — keeps the designer's exact layout) or an
// image (one FULL-BLEED page matching the image's aspect ratio: no white
// margins, correct portrait/landscape orientation). Returns pages added.
async function appendBytes(merged: PDFDocument, bytes: Uint8Array): Promise<number> {
  if (isPdfBytes(bytes)) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const pages = await merged.copyPages(src, src.getPageIndices())
    for (const p of pages) merged.addPage(p)
    return pages.length
  }
  // Image → page sized exactly to the image, image drawn edge-to-edge.
  let img: PDFImage
  if (bytes[0] === 0x89 && bytes[1] === 0x50) img = await merged.embedPng(bytes)
  else img = await merged.embedJpg(bytes)
  const A4_LONG = 841.89
  const ratio = img.width / img.height
  const pw = ratio >= 1 ? A4_LONG : A4_LONG * ratio
  const ph = ratio >= 1 ? A4_LONG / ratio : A4_LONG
  const page = merged.addPage([pw, ph])
  page.drawImage(img, { x: 0, y: 0, width: pw, height: ph })
  return 1
}

// Append from a URL (cover/back), swallowing fetch errors so one missing
// template never kills the whole render.
async function appendUrl(merged: PDFDocument, url: string | null | undefined): Promise<number> {
  if (!url) return 0
  try {
    return await appendBytes(merged, await fetchBuffer(url))
  } catch {
    return 0
  }
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  if (!isPdfBytes(bytes)) return 1
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    return src.getPageCount()
  } catch {
    return 1
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ))
}

interface TocEntry { name_ar: string; name_en: string; startPage: number }

function buildTocHtml(entries: TocEntry[], title: { ar: string; en: string }): string {
  const rows = entries.map((e, i) => `
    <div class="row">
      <span class="idx">${i + 1}.</span>
      <span class="name">${escapeHtml(e.name_ar || e.name_en || '—')}${e.name_en && e.name_ar ? `<span class="en"> — ${escapeHtml(e.name_en)}</span>` : ''}</span>
      <span class="leader"></span>
      <span class="page-num">${e.startPage}</span>
    </div>`).join('')

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Tajawal', sans-serif; color: #1f2937; }
  .page { width: 210mm; min-height: 297mm; padding: 26mm 22mm; }
  .head { border-bottom: 3px solid #39540b; padding-bottom: 14px; margin-bottom: 30px; }
  .title { font-size: 30px; font-weight: 700; color: #39540b; }
  .subtitle { font-size: 13px; color: #6b7280; margin-top: 4px; letter-spacing: .5px; }
  .row { display: flex; align-items: baseline; gap: 10px; padding: 12px 0; font-size: 17px; border-bottom: 1px solid #f1f5f9; }
  .idx { color: #9ca3af; font-variant-numeric: tabular-nums; min-width: 24px; }
  .name { font-weight: 500; }
  .name .en { font-size: 12px; color: #9ca3af; }
  .leader { flex: 1; border-bottom: 1.5px dotted #cbd5e1; transform: translateY(-5px); }
  .page-num { font-weight: 700; color: #39540b; font-variant-numeric: tabular-nums; min-width: 38px; text-align: left; }
</style></head>
<body><div class="page">
  <div class="head"><div class="title">${escapeHtml(title.ar)}</div><div class="subtitle">${escapeHtml(title.en)}</div></div>
  ${rows}
</div></body></html>`
}

export async function buildPreQualPdf(input: PreQualBuildInput): Promise<Uint8Array> {
  const merged = await PDFDocument.create()

  // 1) Cover (fixed template).
  await appendUrl(merged, input.coverUrl)

  // 2) Pre-fetch the documents once: keep bytes for merging AND count pages so
  //    the TOC knows where each one starts (page 1 = the first document).
  const docBytes: Uint8Array[] = []
  const tocEntries: TocEntry[] = []
  let runningStart = 1
  for (const d of input.documents) {
    if (!d.url) continue
    let bytes: Uint8Array
    try { bytes = await fetchBuffer(d.url) } catch { continue }
    const count = await pageCountOf(bytes)
    docBytes.push(bytes)
    tocEntries.push({ name_ar: d.name_ar || '', name_en: d.name_en || '', startPage: runningStart })
    runningStart += count
  }

  // 3) Table of Contents (HTML→PDF for proper Arabic), inserted after the cover.
  if (tocEntries.length > 0) {
    try {
      const tocPdf = await renderHtmlToPdf(buildTocHtml(tocEntries, input.tocTitle || { ar: 'جدول المحتويات', en: 'Table of Contents' }))
      await appendBytes(merged, tocPdf)
    } catch { /* TOC is best-effort — never block the packet on it */ }
  }

  // 4) The documents themselves (no auto stamp — the cover/back the team
  //    designs carry their own signature/seal).
  for (const bytes of docBytes) {
    try { await appendBytes(merged, bytes) } catch { /* skip a broken doc */ }
  }

  // 5) Back (fixed template).
  await appendUrl(merged, input.backUrl)

  if (merged.getPageCount() === 0) merged.addPage([595.28, 841.89])

  return await merged.save()
}
