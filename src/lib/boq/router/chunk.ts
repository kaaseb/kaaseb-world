// Large-BOQ chunking for phase 1.
//
// A 500-row BOQ read in ONE structured call can exceed the model's output
// budget and silently truncate the tail. Text BOQs (Excel/CSV converted to
// CSV, or a PDF whose text extracted) are split at SAFE boundaries — blank
// lines, sheet breaks, section headings — never mid-item, and every part
// carries its sheet name + column headers as "# CONTEXT" lines so the model
// keeps the column meaning. Small BOQs are untouched (one call, as before).
//
// Pure; covered by tests/chunk.test.ts.

export const BOQ_CHUNK_TRIGGER_LINES = 350 // ≤ this: single call, unchanged behaviour
export const BOQ_CHUNK_TARGET_LINES = 220
const LOOKAHEAD = 90
const HEADER_LINES = 4
export const CONTEXT_PREFIX = '# CONTEXT:'

export function decodeTextFile(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8')
}

const UNIT_CELL = /^(?:m2|m²|sqm|sm|m|lm|rm|pcs|pc|no\.?|nos\.?|ea|set|lot|kg|ton|م2|م|مط|عدد|حبة|قطعة|مقطوعية)$/i

/** Is this line a safe place to cut? Blank, a sheet break, or a heading row. */
export function isSafeBoundary(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (t.startsWith('## Sheet:')) return true
  const cells = t.split(',').map((c) => c.trim()).filter(Boolean)
  if (cells.length === 0) return true
  const itemish =
    cells.some((c) => UNIT_CELL.test(c)) ||
    cells.some((c) => /^\d+(?:[.,]\d+)?$/.test(c) && Number(c.replace(',', '.')) >= 10)
  if (itemish) return false
  const headerish = cells.some((c) => {
    const letters = c.replace(/[^A-Za-z؀-ۿ ]/g, '').trim()
    const words = letters.split(/\s+/).filter(Boolean)
    return (
      /^(?:division|div\.?|section|bill\s*no|part|chapter|schedule)\b/i.test(c) ||
      (words.length >= 2 && letters === letters.toUpperCase() && /[A-Z]/.test(letters))
    )
  })
  return headerish
}

/**
 * Split a text BOQ into parts. Returns [text] unchanged when small enough.
 * Every continuation part starts with the current sheet line + its first
 * header lines, each prefixed with CONTEXT_PREFIX so they are never extracted.
 */
export function splitBoqText(text: string, trigger = BOQ_CHUNK_TRIGGER_LINES, target = BOQ_CHUNK_TARGET_LINES): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length <= trigger) return [text]

  const chunks: string[] = []
  let cur: string[] = []
  let sheetLine = ''
  let header: string[] = []
  let capturing = 0

  const context = () =>
    [sheetLine, ...header].filter(Boolean).map((l) => `${CONTEXT_PREFIX} ${l}`)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('## Sheet:')) {
      // A new sheet: close the running part if it has real content.
      if (cur.some((l) => !l.startsWith(CONTEXT_PREFIX) && l.trim())) { chunks.push(cur.join('\n')); cur = [] }
      sheetLine = line
      header = []
      capturing = HEADER_LINES
      cur.push(line)
      i++
      continue
    }
    if (capturing > 0 && line.trim()) { header.push(line); capturing-- }
    cur.push(line)
    i++

    if (cur.length >= target) {
      // Extend to the next safe boundary (bounded), then cut.
      let cut = i
      for (let k = i; k < Math.min(lines.length, i + LOOKAHEAD); k++) {
        if (isSafeBoundary(lines[k])) { cut = k; break }
      }
      while (i < cut) { cur.push(lines[i]); i++ }
      chunks.push(cur.join('\n'))
      cur = i < lines.length ? [...context()] : []
    }
  }
  if (cur.some((l) => !l.startsWith(CONTEXT_PREFIX) && l.trim())) chunks.push(cur.join('\n'))
  return chunks.length > 0 ? chunks : [text]
}
