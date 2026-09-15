// Heavy-CPU worker — runs OFF the main Node thread (see src/lib/heavy).
//
// Why: Next.js serves every user from ONE event loop. Parsing a 20MB Excel,
// extracting text from a 400-page PDF, unzipping a drawing set, unpacking a
// 200MB RAR or hashing 80MB are all synchronous CPU work; done on the main
// thread they freeze EVERY request for seconds — the "النظام يهنق" the team
// sees. Here they run in a worker thread; the main thread only awaits.
//
// Plain ESM (no bundler): loaded by path at runtime from <cwd>/workers, with
// node_modules next to it. Keep this file dependency-light and self-contained.

import { parentPort } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

let XLSX = null
function xlsx() { return XLSX || (XLSX = require('xlsx')) }
let fflate = null
function zipLib() { return fflate || (fflate = require('fflate')) }
let pdfLib = null
function pdflib() { return pdfLib || (pdfLib = require('pdf-lib')) }
let unpdf = null
async function unpdfLib() { return unpdf || (unpdf = await import('unpdf')) }
let unrar = null
function unrarLib() { return unrar || (unrar = require('node-unrar-js')) }
let wasm = null
function unrarWasm() {
  if (wasm) return wasm
  const b = readFileSync(require.resolve('node-unrar-js/dist/js/unrar.wasm'))
  wasm = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return wasm
}

const toBuf = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
const junk = (p) => {
  const base = p.split('/').pop() || ''
  return p.endsWith('/') || /(^|\/)__MACOSX\//.test(p) || base.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(base) || /\.(bak|tmp|log|lnk|ini|db)$/i.test(base) || base === ''
}

const ops = {
  sha256(buf) {
    return { result: createHash('sha256').update(toBuf(buf)).digest('hex'), transfer: [] }
  },

  /** ZIP → entries (junk skipped). Data transferred zero-copy back. */
  unzip(buf, { entryCap = Infinity } = {}) {
    const files = zipLib().unzipSync(buf, { filter: (f) => !junk(f.name) && f.originalSize <= entryCap })
    const entries = []
    const transfer = []
    for (const p of Object.keys(files)) {
      const data = files[p]
      delete files[p]
      if (junk(p) || data.length === 0) continue
      entries.push({ path: p, data })
      transfer.push(data.buffer)
    }
    return { result: { entries }, transfer: [...new Set(transfer)] }
  },

  /** Excel → [{ name, csv }] per sheet. */
  xlsxSheets(buf, { csvCap = Infinity } = {}) {
    const X = xlsx()
    const wb = X.read(toBuf(buf), { type: 'buffer' })
    const sheets = wb.SheetNames.map((name) => ({
      name,
      csv: X.utils.sheet_to_csv(wb.Sheets[name], { strip: true, blankrows: false }).slice(0, csvCap),
    }))
    return { result: { sheets }, transfer: [] }
  },

  /** PDF → text per page (null when the PDF can't be parsed). */
  async pdfText(buf) {
    try {
      const { extractText, getDocumentProxy } = await unpdfLib()
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const { text } = await extractText(pdf, { mergePages: false })
      const pages = Array.isArray(text) ? text.map((p) => String(p || '')) : [String(text || '')]
      return { result: { pages }, transfer: [] }
    } catch {
      return { result: { pages: null }, transfer: [] }
    }
  },

  async pdfPageCount(buf) {
    try {
      const { PDFDocument } = pdflib()
      const doc = await PDFDocument.load(toBuf(buf), { ignoreEncryption: true, updateMetadata: false })
      return { result: doc.getPageCount(), transfer: [] }
    } catch {
      return { result: 0, transfer: [] }
    }
  },

  /** One page (or a small range) copied into a standalone PDF. */
  async pdfPageRange(buf, { from, to }) {
    const { PDFDocument } = pdflib()
    const src = await PDFDocument.load(toBuf(buf), { ignoreEncryption: true, updateMetadata: false })
    const out = await PDFDocument.create()
    const count = src.getPageCount()
    const a = Math.min(Math.max(1, from), count) - 1
    const b = Math.min(Math.max(from, to), count) - 1
    const idx = Array.from({ length: b - a + 1 }, (_, i) => a + i)
    const copied = await out.copyPages(src, idx)
    for (const p of copied) out.addPage(p)
    const bytes = await out.save()
    return { result: bytes, transfer: [bytes.buffer] }
  },

  /** RAR → { encrypted, entries: [{ path, data }] } (junk + oversize skipped). */
  async rarExtract(buf, { entryCap = Infinity, totalCap = Infinity, maxEntries = 400 } = {}) {
    const { createExtractorFromData } = unrarLib()
    const exact = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    const data = exact ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const extractor = await createExtractorFromData({ wasmBinary: unrarWasm(), data })
    const list = extractor.getFileList()
    if (list.arcHeader.flags.headerEncrypted) return { result: { encrypted: true, entries: [], skipped: [] }, transfer: [] }
    const headers = Array.from(list.fileHeaders)
    if (headers.some((h) => h.flags.encrypted)) return { result: { encrypted: true, entries: [], skipped: [] }, transfer: [] }
    const skipped = []
    const wanted = new Set()
    let total = 0
    for (const h of headers) {
      if (h.flags.directory || junk(h.name) || h.unpSize === 0) continue
      if (h.unpSize > entryCap) { skipped.push({ path: h.name, why: 'entry-cap' }); continue }
      if (total + h.unpSize > totalCap) { skipped.push({ path: h.name, why: 'total-cap' }); continue }
      if (wanted.size >= maxEntries) { skipped.push({ path: h.name, why: 'max-entries' }); continue }
      total += h.unpSize
      wanted.add(h.name)
    }
    const entries = []
    const transfer = []
    const extracted = extractor.extract({ files: (h) => wanted.has(h.name) })
    for (const f of extracted.files) {
      if (!f.extraction || f.extraction.length === 0) continue
      entries.push({ path: f.fileHeader.name, data: f.extraction })
      transfer.push(f.extraction.buffer)
    }
    return { result: { encrypted: false, entries, skipped }, transfer: [...new Set(transfer)] }
  },
}

parentPort.on('message', async (msg) => {
  const { id, op, buf, opts } = msg
  try {
    const fn = ops[op]
    if (!fn) throw new Error(`unknown op ${op}`)
    const { result, transfer } = await fn(buf, opts || {})
    parentPort.postMessage({ id, ok: true, result }, transfer)
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
