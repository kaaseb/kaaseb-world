// Open the archives clients actually send (ZIP, RAR — including RAR5) in
// memory and hand back the real files. A BOQ transfer is almost always
// "Stone & Marble.rar" holding Excel + PDFs; the AI needs the files inside, not
// the container.
//
//   • ZIP → fflate (already a dependency).
//   • RAR → node-unrar-js (WASM build of the official unrar; MIT). The wasm
//     binary is read once from node_modules — no network, no temp files.
//   • Anything else (7z, tar) → not an archive we open; the caller stores the
//     file as-is and says so.
//
// Guards: directory entries, __MACOSX / dotfiles / Thumbs.db are skipped; each
// entry and the total are capped so a zip-bomb cannot exhaust memory; encrypted
// archives are reported, never guessed at.

import { readFileSync } from 'fs'
import path from 'path'
import { unzipSync } from 'fflate'

export interface ArchiveEntry { name: string; data: Uint8Array }
export interface ArchiveResult {
  /** Entries handed to the callback. */
  count: number
  /** Human notes: skipped-too-large names, encrypted, etc. */
  notices: string[]
}
/** Called per entry, in archive order; the entry's bytes are released after it returns. */
export type EntrySink = (entry: ArchiveEntry) => Promise<void>

export const ENTRY_CAP = 120 * 1024 * 1024
export const TOTAL_CAP = 600 * 1024 * 1024
const MAX_ENTRIES = 400

export type ArchiveKind = 'zip' | 'rar' | null

export function archiveKind(name: string, buf?: Uint8Array): ArchiveKind {
  const n = (name || '').toLowerCase()
  if (buf && buf.length >= 4) {
    if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)) {
      // PK: a zip — but xlsx/docx are zips too; only treat as archive by name.
      if (/\.zip$/.test(n)) return 'zip'
      if (!/\.(xlsx|xlsm|docx|pptx|odt|ods)$/.test(n) && !/\.[a-z0-9]{2,5}$/.test(n)) return 'zip'
      return null
    }
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'rar'
  }
  if (/\.zip$/.test(n)) return 'zip'
  if (/\.rar$/.test(n)) return 'rar'
  return null
}

function junk(path: string): boolean {
  const base = path.split('/').pop() || ''
  // AutoCAD .bak / editor temp files are duplicates of the real drawing — never useful.
  return path.endsWith('/') || /(^|\/)__MACOSX\//.test(path) || base.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(base) || /\.(bak|tmp|log|lnk|ini|db)$/i.test(base) || base === ''
}

/** Keep the folder context in the name: "Drawings/A-301.pdf" → "Drawings › A-301.pdf". */
function displayName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 1 ? `${parts.slice(0, -1).join(' › ')} › ${parts[parts.length - 1]}` : parts[0] || 'file'
}

let wasmBinary: ArrayBuffer | null = null
function loadWasm(): ArrayBuffer {
  if (wasmBinary) return wasmBinary
  // The package is a server-external (next.config) so it stays in node_modules
  // at runtime, next to its wasm — no bundler asset handling needed.
  const b = readFileSync(path.join(process.cwd(), 'node_modules', 'node-unrar-js', 'dist', 'js', 'unrar.wasm'))
  wasmBinary = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return wasmBinary
}

export async function extractArchive(kind: ArchiveKind, buf: Uint8Array, sink: EntrySink): Promise<ArchiveResult> {
  const notices: string[] = []
  let total = 0
  let count = 0
  let overflowNoted = false
  const take = async (path: string, data: Uint8Array) => {
    if (junk(path)) return
    if (count >= MAX_ENTRIES) { if (!overflowNoted) { overflowNoted = true; notices.push(`تجاوز الأرشيف ${MAX_ENTRIES} ملف — تم أخذ الأوائل فقط`) } return }
    if (data.length === 0) return
    if (data.length > ENTRY_CAP) { notices.push(`تخطّي «${displayName(path)}» — أكبر من ${Math.round(ENTRY_CAP / 1048576)}MB`); return }
    if (total + data.length > TOTAL_CAP) { notices.push(`تخطّي «${displayName(path)}» — تجاوز الحجم الكلي المسموح`); return }
    total += data.length
    count++
    await sink({ name: displayName(path), data })
  }

  if (kind === 'zip') {
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(buf, {
        filter: (f) => !junk(f.name) && f.originalSize <= ENTRY_CAP,
      })
    } catch (e) {
      throw new Error(`تعذّر فتح ملف ZIP — ${e instanceof Error ? e.message : 'تالف أو مشفّر'}`)
    }
    for (const path of Object.keys(files)) {
      const data = files[path]
      delete files[path] // release as we go
      await take(path, data)
    }
    return { count, notices }
  }

  if (kind === 'rar') {
    const { createExtractorFromData } = await import('node-unrar-js')
    let extractor: Awaited<ReturnType<typeof createExtractorFromData>>
    try {
      // Hand the exact ArrayBuffer over without copying when the view already
      // covers it (a 200MB transfer must not be duplicated in memory).
      const exact = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
      const data = (exact ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as ArrayBuffer
      extractor = await createExtractorFromData({ wasmBinary: loadWasm(), data })
    } catch (e) {
      throw new Error(`تعذّر فتح ملف RAR — ${e instanceof Error ? e.message : 'تالف'}`)
    }
    const list = extractor.getFileList()
    if (list.arcHeader.flags.headerEncrypted) throw new Error('ملف RAR محمي بكلمة مرور — افتحه وحمّل الملفات ثم ارفعها')
    const headers = Array.from(list.fileHeaders)
    if (headers.some((h) => h.flags.encrypted)) throw new Error('ملف RAR محمي بكلمة مرور — افتحه وحمّل الملفات ثم ارفعها')
    const wanted = new Set(headers.filter((h) => !h.flags.directory && !junk(h.name) && h.unpSize <= ENTRY_CAP).map((h) => h.name))
    for (const h of headers) if (!h.flags.directory && !junk(h.name) && h.unpSize > ENTRY_CAP) notices.push(`تخطّي «${displayName(h.name)}» — أكبر من ${Math.round(ENTRY_CAP / 1048576)}MB`)
    // `files` is a lazy generator: each entry is decompressed when iterated and
    // dropped after the sink returns — the whole archive is never in memory twice.
    let extracted: ReturnType<typeof extractor.extract>
    try {
      extracted = extractor.extract({ files: (h) => wanted.has(h.name) })
    } catch (e) {
      throw new Error(`تعذّر فك ملف RAR — ${e instanceof Error ? e.message : 'تالف'}`)
    }
    for (const f of extracted.files) {
      if (f.extraction) await take(f.fileHeader.name, f.extraction)
    }
    return { count, notices }
  }

  return { count: 0, notices: ['ليس أرشيفاً ندعمه'] }
}
