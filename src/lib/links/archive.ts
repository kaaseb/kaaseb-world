// Open the archives clients actually send (ZIP, RAR — including RAR5) and hand
// back the real files. A BOQ transfer is almost always "Stone & Marble.rar"
// holding Excel + PDFs; the AI needs the files inside, not the container.
//
// The unpacking itself runs in the heavy worker pool (src/lib/heavy) — a 200MB
// RAR is seconds of pure CPU that must never sit on the request thread.
//
// Guards: directory entries, __MACOSX / dotfiles / Thumbs.db / AutoCAD .bak are
// skipped; each entry and the total are capped so a zip-bomb cannot exhaust
// memory; encrypted archives are reported, never guessed at.

import { heavy } from '@/lib/heavy'

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

/** Keep the folder context in the name: "Drawings/A-301.pdf" → "Drawings › A-301.pdf". */
function displayName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 1 ? `${parts.slice(0, -1).join(' › ')} › ${parts[parts.length - 1]}` : parts[0] || 'file'
}

const mb = (n: number) => Math.round(n / 1048576)

export async function extractArchive(kind: ArchiveKind, buf: Uint8Array, sink: EntrySink): Promise<ArchiveResult> {
  const notices: string[] = []
  let total = 0
  let count = 0
  let overflowNoted = false
  const noteSkip = (s: { path: string; why: string }) => {
    if (s.why === 'entry-cap') notices.push(`تخطّي «${displayName(s.path)}» — أكبر من ${mb(ENTRY_CAP)}MB`)
    else if (s.why === 'total-cap') notices.push(`تخطّي «${displayName(s.path)}» — تجاوز الحجم الكلي المسموح`)
    else if (!overflowNoted) { overflowNoted = true; notices.push(`تجاوز الأرشيف ${MAX_ENTRIES} ملف — تم أخذ الأوائل فقط`) }
  }
  const take = async (path: string, data: Uint8Array) => {
    if (count >= MAX_ENTRIES) { if (!overflowNoted) { overflowNoted = true; notices.push(`تجاوز الأرشيف ${MAX_ENTRIES} ملف — تم أخذ الأوائل فقط`) } return }
    if (data.length === 0) return
    if (data.length > ENTRY_CAP) { notices.push(`تخطّي «${displayName(path)}» — أكبر من ${mb(ENTRY_CAP)}MB`); return }
    if (total + data.length > TOTAL_CAP) { notices.push(`تخطّي «${displayName(path)}» — تجاوز الحجم الكلي المسموح`); return }
    total += data.length
    count++
    await sink({ name: displayName(path), data })
  }

  if (kind === 'zip') {
    let z
    try {
      // Caps are enforced inside the worker, before anything is decompressed.
      z = await heavy.unzip(buf, { entryCap: ENTRY_CAP, totalCap: TOTAL_CAP, maxEntries: MAX_ENTRIES }, true) // bytes moved, not copied
    } catch (e) {
      throw new Error(`تعذّر فتح ملف ZIP — ${e instanceof Error ? e.message : 'تالف أو مشفّر'}`)
    }
    for (const s of z.skipped || []) noteSkip(s)
    for (const en of z.entries) await take(en.path, en.data)
    return { count, notices }
  }

  if (kind === 'rar') {
    let r
    try {
      r = await heavy.rarExtract(buf, { entryCap: ENTRY_CAP, totalCap: TOTAL_CAP, maxEntries: MAX_ENTRIES }, true) // bytes moved, not copied
    } catch (e) {
      throw new Error(`تعذّر فتح ملف RAR — ${e instanceof Error ? e.message : 'تالف'}`)
    }
    if (r.encrypted) throw new Error('ملف RAR محمي بكلمة مرور — افتحه وحمّل الملفات ثم ارفعها')
    for (const s of r.skipped) noteSkip(s)
    for (const en of r.entries) await take(en.path, en.data)
    return { count, notices }
  }

  return { count: 0, notices: ['ليس أرشيفاً ندعمه'] }
}
