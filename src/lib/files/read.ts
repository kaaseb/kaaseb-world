// Shared readers built on the content sniffer: open archives (ZIP / RAR, one
// nested level) and pull the text out of a Word document. Used by BOTH the BOQ
// reader (ai/files.ts) and the attachment indexer, so a file is understood the
// same way wherever it enters.
//
// All CPU work goes through the heavy worker pool.

import { heavy } from '@/lib/heavy'
import { sniff, decodeText } from './sniff'

export const ARCHIVE_CAPS = { entryCap: 120 * 1024 * 1024, totalCap: 600 * 1024 * 1024, maxEntries: 400 }
const NEST_SEP = '!/'

export interface ArchiveFile { path: string; data: Buffer }

const view = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength)

/**
 * Every file inside an archive. A ZIP inside a RAR (or the reverse) is opened
 * too — one level, which is what real client packages contain. Encrypted or
 * corrupt archives are reported in `notes`, never thrown.
 */
export async function archiveFiles(buf: Buffer, name: string, depth = 1): Promise<{ files: ArchiveFile[]; notes: string[] }> {
  const kind = sniff(buf, name).kind
  const notes: string[] = []
  let raw: Array<{ path: string; data: Uint8Array }> = []
  try {
    if (kind === 'zip') {
      const z = await heavy.unzip(view(buf), ARCHIVE_CAPS)
      raw = z.entries
      if (z.skipped?.length) notes.push(`${name}: تخطّي ${z.skipped.length} ملف داخل الأرشيف (حجم/عدد يتجاوز الحد)`)
    } else if (kind === 'rar') {
      const r = await heavy.rarExtract(view(buf), ARCHIVE_CAPS)
      if (r.encrypted) { notes.push(`${name}: أرشيف RAR محمي بكلمة مرور — فكّه وارفع الملفات`); return { files: [], notes } }
      raw = r.entries
      if (r.skipped.length) notes.push(`${name}: تخطّي ${r.skipped.length} ملف داخل الأرشيف (حجم/عدد يتجاوز الحد)`)
    } else {
      return { files: [], notes }
    }
  } catch (e) {
    notes.push(`${name}: تعذّر فتح الأرشيف — ${e instanceof Error ? e.message : 'تالف'}`)
    return { files: [], notes }
  }

  const files: ArchiveFile[] = []
  for (const en of raw) {
    const data = toBuffer(en.data)
    const base = en.path.split('/').pop() || en.path
    const inner = sniff(data, base).kind
    if (depth < 2 && (inner === 'zip' || inner === 'rar')) {
      const sub = await archiveFiles(data, base, depth + 1)
      notes.push(...sub.notes)
      for (const f of sub.files) files.push({ path: `${en.path}${NEST_SEP}${f.path}`, data: f.data })
    } else {
      files.push({ path: en.path, data })
    }
  }
  return { files, notes }
}

/** The display name of an archive member ("Drawings/A-301.pdf" → "A-301.pdf"). */
export function memberName(path: string): string {
  const last = path.split(NEST_SEP).pop() || path
  return last.split('/').pop() || last
}

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/**
 * Text of a .docx, with its TABLES kept as tab-separated rows — clients do send
 * a BOQ as a Word table. Returns null when the document has no body.
 */
export async function docxText(buf: Buffer): Promise<string | null> {
  let entries: Array<{ path: string; data: Uint8Array }>
  try {
    entries = (await heavy.unzip(view(buf), { entryCap: 60 * 1024 * 1024, totalCap: 200 * 1024 * 1024, maxEntries: 2000 })).entries
  } catch {
    return null
  }
  const doc = entries.find((e) => e.path === 'word/document.xml')
  if (!doc) return null
  const xml = decodeText(doc.data)
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > 0 ? text : null
}
