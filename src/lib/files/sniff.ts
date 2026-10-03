// What a file IS, decided from its BYTES — never from its name alone.
//
// Why: file names lie, and ours lie on purpose. An uploaded "BOQ.xlsm",
// "tender.zip" or "drawings.rar" is stored under a key ending ".bin" (the
// bucket only keeps a short list of extensions), a client exports CSV as
// ".txt", saves an HTML table as ".xls", renames a ZIP ".xlsx"… and the reader
// used to trust the name: unknown extension → "no readable content" → the whole
// project failed with "could not read the BOQ". Twenty companies a day means
// every one of those happens weekly.
//
// So: magic bytes first, container contents second, the name only as a hint.
// Pure and synchronous; covered by tests/sniff.test.ts.

export type FileKind =
  | 'spreadsheet'   // xlsx / xlsm / xlsb / xls / ods / HTML-table-as-xls — SheetJS reads them all
  | 'delimited'     // csv / tsv / semicolon-separated text
  | 'text'          // plain text
  | 'pdf'
  | 'docx'          // Word (OOXML) — text and tables are extractable
  | 'doc-legacy'    // old binary .doc — not readable here
  | 'pptx'
  | 'image'
  | 'zip' | 'rar' | '7z' | 'gzip' | 'tar'
  | 'dwg' | 'dxf'
  | 'video'
  | 'encrypted-office' // password-protected Excel/Word
  | 'unknown'

export interface Sniffed {
  kind: FileKind
  /** A mime type suitable for the model / for serving. */
  mime: string
}

const ascii = (buf: Uint8Array, start: number, len: number) => {
  let s = ''
  for (let i = start; i < Math.min(buf.length, start + len); i++) s += String.fromCharCode(buf[i])
  return s
}
const startsWith = (buf: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => buf[at + i] === b)

function indexOfAscii(buf: Uint8Array, needle: string, limit = buf.length): number {
  const n = needle.length
  const end = Math.min(buf.length, limit) - n
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < n; j++) if (buf[i + j] !== needle.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

export function extOf(name: string): string {
  const base = (name || '').toLowerCase().split('?')[0].split('#')[0]
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1) : ''
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic' }
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp'])
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Is this mostly human text? (after a possible BOM) */
function looksLikeText(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 4096)
  if (n === 0) return false
  // UTF-16 BOMs are text by definition.
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return true
  let bad = 0
  for (let i = 0; i < n; i++) {
    const c = buf[i]
    if (c === 0) return false
    if (c < 9 || (c > 13 && c < 32)) bad++
  }
  return bad / n < 0.02
}

export function sniff(buf: Uint8Array, name = ''): Sniffed {
  const ext = extOf(name)
  if (!buf || buf.length === 0) return { kind: 'unknown', mime: 'application/octet-stream' }

  // ── unambiguous magic numbers ──
  if (ascii(buf, 0, 5) === '%PDF-' || indexOfAscii(buf, '%PDF-', 1024) >= 0) return { kind: 'pdf', mime: 'application/pdf' }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mime: 'image/png' }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' }
  if (ascii(buf, 0, 4) === 'GIF8') return { kind: 'image', mime: 'image/gif' }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp' }
  if (ascii(buf, 0, 2) === 'BM' && ext === 'bmp') return { kind: 'image', mime: 'image/bmp' }
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return { kind: 'image', mime: 'image/tiff' }
  if (ascii(buf, 0, 4) === 'Rar!') return { kind: 'rar', mime: 'application/vnd.rar' }
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: '7z', mime: 'application/x-7z-compressed' }
  if (startsWith(buf, [0x1f, 0x8b])) return { kind: 'gzip', mime: 'application/gzip' }
  if (ascii(buf, 257, 5) === 'ustar') return { kind: 'tar', mime: 'application/x-tar' }
  if (/^AC10\d\d/.test(ascii(buf, 0, 6))) return { kind: 'dwg', mime: 'application/acad' }
  if (ascii(buf, 4, 4) === 'ftyp') return { kind: VIDEO_EXTS.has(ext) || !IMAGE_MIME[ext] ? 'video' : 'image', mime: IMAGE_MIME[ext] || 'video/mp4' }

  // ── ZIP container: an Office document, or a real archive ──
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    // Entry names are stored uncompressed — look for the tell-tale parts.
    if (indexOfAscii(buf, 'xl/workbook') >= 0 || indexOfAscii(buf, 'xl/worksheets') >= 0) return { kind: 'spreadsheet', mime: XLSX_MIME }
    if (indexOfAscii(buf, 'word/document') >= 0) return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    if (indexOfAscii(buf, 'ppt/presentation') >= 0 || indexOfAscii(buf, 'ppt/slides') >= 0) return { kind: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
    if (indexOfAscii(buf, 'opendocument.spreadsheet', 4096) >= 0) return { kind: 'spreadsheet', mime: XLSX_MIME }
    return { kind: 'zip', mime: 'application/zip' }
  }

  // ── OLE2 compound file: old Excel/Word, or a password-protected OOXML ──
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // Directory entry names are UTF-16LE: "EncryptedPackage" → E\0n\0c\0…
    const utf16 = (s: string) => s.split('').join('\0')
    if (indexOfAscii(buf, utf16('EncryptedPackage')) >= 0) return { kind: 'encrypted-office', mime: 'application/octet-stream' }
    if (indexOfAscii(buf, utf16('Workbook')) >= 0 || indexOfAscii(buf, utf16('Book')) >= 0) return { kind: 'spreadsheet', mime: 'application/vnd.ms-excel' }
    if (indexOfAscii(buf, utf16('WordDocument')) >= 0) return { kind: 'doc-legacy', mime: 'application/msword' }
    return ext === 'doc' ? { kind: 'doc-legacy', mime: 'application/msword' } : { kind: 'spreadsheet', mime: 'application/vnd.ms-excel' }
  }

  // ── text-shaped content ──
  if (looksLikeText(buf)) {
    const head = ascii(buf, 0, 2048).replace(/^﻿|^ï»¿/, '').trimStart().toLowerCase()
    // Excel "Save as web page" / ERP exports: an HTML table named .xls.
    if (/^<(?:!doctype html|html|table|\?xml[^>]*>\s*<\?mso|meta)/.test(head) && /<table|<tr|<td/.test(ascii(buf, 0, 65536).toLowerCase())) {
      return { kind: 'spreadsheet', mime: 'application/vnd.ms-excel' }
    }
    // SpreadsheetML 2003 (.xml saved from Excel).
    if (head.startsWith('<?xml') && /urn:schemas-microsoft-com:office:spreadsheet/.test(ascii(buf, 0, 4096))) return { kind: 'spreadsheet', mime: 'application/vnd.ms-excel' }
    if (/^\s*0\s*\r?\nSECTION/i.test(ascii(buf, 0, 64)) || ext === 'dxf') return { kind: 'dxf', mime: 'application/dxf' }
    if (ext === 'csv' || ext === 'tsv') return { kind: 'delimited', mime: 'text/csv' }
    // A delimiter that repeats on most of the first lines = a table, whatever the name.
    const lines = ascii(buf, 0, 4096).split(/\r?\n/).filter((l) => l.trim()).slice(0, 12)
    if (lines.length >= 3) {
      for (const d of [',', ';', '\t', '|']) {
        const counts = lines.map((l) => l.split(d).length - 1)
        if (counts.filter((c) => c >= 2).length >= Math.ceil(lines.length * 0.7)) return { kind: 'delimited', mime: 'text/csv' }
      }
    }
    return { kind: 'text', mime: 'text/plain' }
  }

  // ── nothing matched: the name is the last resort ──
  if (IMAGE_MIME[ext]) return { kind: 'image', mime: IMAGE_MIME[ext] }
  if (VIDEO_EXTS.has(ext)) return { kind: 'video', mime: 'video/mp4' }
  if (ext === 'dwg') return { kind: 'dwg', mime: 'application/acad' }
  return { kind: 'unknown', mime: 'application/octet-stream' }
}

/**
 * Decode text bytes robustly: UTF-8 (with/without BOM), UTF-16 (BOM), and the
 * legacy Arabic code page Windows-1256 that Saudi ERPs still export CSV in —
 * read as UTF-8 those files turn every Arabic cell into "Ø§Ù„".
 */
export function decodeText(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    try { return new TextDecoder('windows-1256').decode(buf) } catch { return new TextDecoder('latin1').decode(buf) }
  }
}

/** Why a file cannot be read, in the user's language — or null when it can. */
export function unreadableReason(kind: FileKind): string | null {
  switch (kind) {
    case 'encrypted-office': return 'الملف محمي بكلمة مرور — افتحه في Excel واحفظه بدون كلمة مرور ثم ارفعه'
    case 'doc-legacy': return 'ملف Word قديم (.doc) — احفظه بصيغة .docx أو PDF ثم ارفعه'
    case '7z': return 'أرشيف 7z غير مدعوم — فكّه وارفع الملفات، أو أرسله ZIP/RAR'
    case 'gzip': case 'tar': return 'أرشيف tar/gz غير مدعوم — فكّه وارفع الملفات، أو أرسله ZIP/RAR'
    case 'dwg': case 'dxf': return 'ملف AutoCAD — يُحفظ مع المشروع لكنه لا يُقرأ آلياً؛ ارفع نسخة PDF من المخطط لتُقرأ'
    case 'pptx': return 'ملف PowerPoint — احفظه PDF ثم ارفعه ليُقرأ'
    case 'video': return 'ملف فيديو — لا يُقرأ'
    case 'unknown': return 'صيغة غير معروفة — لا تُقرأ آلياً'
    default: return null
  }
}
