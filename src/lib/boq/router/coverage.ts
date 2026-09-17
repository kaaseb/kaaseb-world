// BOQ Router — ROW COVERAGE: the file's own rows, counted deterministically,
// checked against what the model extracted.
//
// The failure this closes: a 16-row paving BOQ came back as 12 items and
// nobody could tell from the screen. The model is asked to extract every row;
// nothing VERIFIED that it did. Now:
//
//   1. candidateRows(csv)  — free, deterministic: every line of the workbook
//                            that looks like a priceable row (a unit cell next
//                            to a quantity cell, with a description).
//   2. unmatchedRows()     — candidates no extracted item accounts for
//                            (token overlap, numbers weighted double).
//   3. the pipeline sends the unmatched lines BACK to the model in a targeted
//                            second pass ("these rows exist in the file — extract
//                            each, or say why it is not an item"), then reports
//                            whatever is still missing BY TEXT in the summary.
//
// A wrong count is now visible; a silently dropped customer line is not
// possible. Pure; covered by tests/coverage.test.ts.

import { normalizeText } from './core'

export interface CandidateRow {
  line: number
  text: string
  qty: number
  unit: string
}

const UNIT_TOKENS = new Set([
  'nr', 'no', 'no.', 'nos', 'nos.', 'pcs', 'pc', 'pce', 'ea', 'each', 'unit', 'units', 'set', 'sets', 'lot', 'item', 'pair', 'pr',
  'm', 'lm', 'rm', 'mt', 'mtr', 'ml', 'm2', 'sqm', 'sm', 'sq.m', 'sq m', 'm²', 'm3', 'cum', 'cbm', 'm³', 'kg', 'ton', 'tonne', 'tons', 't',
  'bag', 'bags', 'roll', 'l', 'ltr', 'sheet', 'slab', 'block', 'ls', 'sum',
  'عدد', 'حبة', 'قطعة', 'قطع', 'طقم', 'متر', 'م', 'مط', 'م.ط', 'م2', 'م٢', 'متر مربع', 'م3', 'متر مكعب', 'كجم', 'طن', 'كيس', 'لفة',
])

/** Minimal CSV line splitter (quoted cells, doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const num = (s: string): number | null => {
  const t = (s || '').replace(/[\s,]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}
const isUnit = (s: string) => UNIT_TOKENS.has((s || '').trim().toLowerCase().replace(/[²]/g, '2').replace(/[³]/g, '3'))
const wordy = (s: string) => (s.match(/[\p{L}]{3,}/gu) || []).length >= 2

/**
 * Lines that look like priceable rows: a unit cell with a positive number in
 * the cell before or after it, plus a descriptive cell somewhere on the line.
 * Header lines ("UNIT,QUANTITY") have no number and never qualify.
 */
const QTY_HEADER = /^(qty|quantity|quantities|الكمية|كمية|العدد)$/i

export function candidateRows(csv: string): CandidateRow[] {
  const out: CandidateRow[] = []
  const lines = (csv || '').split(/\r?\n/)
  // A header row naming the quantity column settles which number is the qty
  // ("Qty, Unit, Rate": the number AFTER the unit is a price, not a quantity).
  let qtyCol = -1
  for (let i = 0; i < Math.min(lines.length, 25) && qtyCol < 0; i++) {
    const cells = splitCsvLine(lines[i])
    const idx = cells.findIndex((x) => QTY_HEADER.test(x))
    if (idx >= 0) qtyCol = idx
  }
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    if (cells.length < 3) continue
    let hit: { qty: number; unit: string } | null = null
    for (let c = 0; c < cells.length && !hit; c++) {
      if (!isUnit(cells[c])) continue
      const byHeader = qtyCol >= 0 ? num(cells[qtyCol] || '') : null
      const before = c > 0 ? num(cells[c - 1]) : null
      const after = c + 1 < cells.length ? num(cells[c + 1]) : null
      // Header column wins; otherwise quantity-then-unit is the common layout
      // and the number after the unit is usually the rate.
      const qty = byHeader ?? before ?? after
      if (qty !== null) hit = { qty, unit: cells[c] }
    }
    if (!hit) continue
    const desc = cells.filter((x) => wordy(x)).sort((a, b) => b.length - a.length)[0]
    if (!desc) continue
    out.push({ line: i + 1, text: desc.slice(0, 300), qty: hit.qty, unit: hit.unit })
  }
  return out
}

const STOP = new Set(['and', 'the', 'for', 'with', 'from', 'this', 'that', 'per', 'to', 'of', 'in', 'on', 'as', 'type', 'size', 'thick', 'mm', 'detail', 'drg', 'fit', 'من', 'في', 'على', 'الى', 'إلى', 'كل', 'مع', 'عن', 'حسب', 'وفق', 'بند'])
function tokens(s: string): Set<string> {
  return new Set(normalizeText(s).split(/[\s.]+/).filter((w) => w.length >= 2 && !STOP.has(w)))
}

export interface ExtractedLike { description: string; details: string | null; quantity: number; unit: string }

/** How well an item accounts for a candidate row: shared tokens / candidate
 *  tokens, numbers counting double; a matching quantity adds a bonus. */
export function rowMatchScore(cand: CandidateRow, item: ExtractedLike): number {
  const ct = tokens(cand.text)
  if (ct.size === 0) return 0
  const it = tokens(`${item.description} ${item.details || ''}`)
  let got = 0
  let total = 0
  for (const w of ct) {
    const weight = /\d/.test(w) ? 2 : 1
    total += weight
    if (it.has(w)) got += weight
  }
  let score = got / total
  if (item.quantity > 0 && Math.abs(item.quantity - cand.qty) < 1e-6) score += 0.15
  return Math.min(1, score)
}

export const MATCH_THRESHOLD = 0.45

/** Candidates that no extracted item accounts for.
 *
 *  ONE item accounts for ONE row (greedy best-score assignment). Without that,
 *  an item "Vanity top ST-02 1425 x 600" would also cover the 1775 x 600 row —
 *  the two share every token but one number — and a variant the model skipped
 *  would pass as extracted. That is the exact way "12 of 16" hid. */
export function unmatchedRows(cands: CandidateRow[], items: ExtractedLike[]): CandidateRow[] {
  const pairs: Array<{ c: number; i: number; s: number }> = []
  cands.forEach((c, ci) => items.forEach((it, ii) => {
    const s = rowMatchScore(c, it)
    if (s >= MATCH_THRESHOLD) pairs.push({ c: ci, i: ii, s })
  }))
  pairs.sort((a, b) => b.s - a.s)
  const candDone = new Set<number>()
  const itemDone = new Set<number>()
  for (const p of pairs) {
    if (candDone.has(p.c) || itemDone.has(p.i)) continue
    candDone.add(p.c)
    itemDone.add(p.i)
  }
  return cands.filter((_, ci) => !candDone.has(ci))
}
