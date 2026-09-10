// Merging phase-1 results from SEVERAL BOQ files of one project.
//
// A client project routinely ships one BOQ per trade plus an "ALL PACKAGES
// COMBINED" workbook. Every file is read completely (each is its own phase-1
// call), then:
//   • items are tagged with their BOQ file, and the pricing-screen `section`
//     becomes "<file> › <sheet>" so the team sees where each line came from;
//   • a line that appears IDENTICALLY (same description + quantity + unit) in
//     two DIFFERENT files is the same customer line twice (the combined
//     workbook repeating a package) — one copy is kept, the other file is
//     recorded on it. Same-file repeats are NOT touched here: the process
//     route flags those for review, because inside one file a repeat may be
//     a genuine second line.
//
// Pure; covered by tests/boq-merge.test.ts.

export interface Phase1Part {
  fileName: string
  subject?: unknown
  detected_departments?: unknown
  items?: Array<Record<string, unknown>>
  notes?: unknown
}

export interface MergedPhase1 {
  subject: string
  detected_departments: string[]
  items: Array<Record<string, unknown>>
  notes: string
}

export function fileStem(name: string): string {
  return (name || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim()
}

export function mergePhase1Parts(parts: Phase1Part[], multiFile: boolean): MergedPhase1 {
  let subject = ''
  const depts = new Map<string, string>()
  const items: Array<Record<string, unknown>> = []
  const notes: string[] = []
  for (const p of parts) {
    if (!subject && typeof p.subject === 'string' && p.subject.trim()) subject = p.subject.trim()
    for (const d of Array.isArray(p.detected_departments) ? p.detected_departments : []) {
      const s = String(d || '').trim()
      if (s && !depts.has(s.toLowerCase())) depts.set(s.toLowerCase(), s)
    }
    const stem = fileStem(p.fileName)
    for (const it of p.items || []) {
      const sheet = String(it.section || '').trim()
      const section = multiFile ? (sheet ? `${stem} › ${sheet}` : stem) : sheet
      items.push({ ...it, section, _boqFile: p.fileName })
    }
    if (typeof p.notes === 'string' && p.notes.trim()) notes.push(multiFile ? `${stem}: ${p.notes.trim()}` : p.notes.trim())
  }
  return { subject, detected_departments: Array.from(depts.values()), items, notes: notes.join(' • ') }
}

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }
function norm(s: string | null | undefined): string {
  return (s || '')
    .replace(/[٠-٩]/g, (d) => AR_DIGITS[d] ?? d)
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .trim()
}

export interface DedupableRow {
  description: string
  quantity: number
  unit: string
  boqFile: string | null
}

export interface DedupeResult<T> {
  rows: T[]
  /** Rows dropped as cross-file copies: which kept row absorbed them. */
  merged: Array<{ kept: T; droppedFrom: string }>
}

/**
 * Drop rows that repeat an earlier row IDENTICALLY (description + quantity +
 * unit) from a DIFFERENT BOQ file. First occurrence (file order) is kept and
 * gets `dupOf` = the other file's name so the audit trail says so.
 */
export function dedupeAcrossFiles<T extends DedupableRow & { dupOf?: string | null }>(rows: T[]): DedupeResult<T> {
  const seen = new Map<string, T>()
  const out: T[] = []
  const merged: Array<{ kept: T; droppedFrom: string }> = []
  for (const r of rows) {
    const key = `${norm(r.description)}|${Number(r.quantity) || 0}|${norm(r.unit)}`
    const prev = seen.get(key)
    if (prev && prev.boqFile && r.boqFile && prev.boqFile !== r.boqFile && norm(r.description).length > 0) {
      prev.dupOf = prev.dupOf ? `${prev.dupOf}، ${r.boqFile}` : r.boqFile
      merged.push({ kept: prev, droppedFrom: r.boqFile })
      continue
    }
    if (!prev) seen.set(key, r)
    out.push(r)
  }
  return { rows: out, merged }
}
