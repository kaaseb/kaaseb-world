// Structural validators run on the rows the model extracted — deterministic
// backstops for the table-structure rules in the phase-1 prompt. A rule that
// lives only in a prompt drifts; these catch the three failure modes seen in
// the owner's real BOQs and hand them to the existing review flags:
//
//   • a SECTION HEADER emitted as an item ("WALL FINISHES", "DIVISION 09")
//     → not a customer line at all: dropped, listed in the run summary.
//   • an ORPHAN VARIANT — a child row that lost its parent's specs
//     ("90mm wide", "A: 100mm") → kept, flagged: it cannot be priced as-is.
//   • a per-room/zone BREAKDOWN that does not add up to the quantity
//     → kept, flagged with both numbers.
//
// Pure and dependency-free; covered by tests/validate.test.ts.

export interface ValidatableRow {
  description: string
  details: string | null | undefined
  quantity: number
  unit: string
}

export interface RowValidation {
  /** true = not a priceable line at all (a section header) — exclude it. */
  drop: boolean
  dropReason: string | null
  /** Review marks to append to the row's flag (amber). */
  marks: string[]
}

const HEADER_VOCAB = /^(?:division|div\.?|section|bill\s*(?:no\.?|number)?|part|chapter|schedule|summary|total)\b|\b(?:finishes|works|cladding work|flooring works|paving works|external works|internal works)\s*$/i
const HEADER_VOCAB_AR = /^(?:قسم|باب|بند رئيسي|فصل|جدول|ملخص|إجمالي|الاجمالي|أعمال|اعمال)\b/

// Natural-stone / product words — a line naming one is a real item, whatever
// its shape. Bilingual, deliberately generous.
const MATERIAL_WORD = /\b(marble|granite|limestone|basalt|travertine|sandstone|slate|onyx|quartzite|terrazzo|porcelain|ceramic|concrete|precast|stone|tile|tiles|slab|slabs|paver|pavers|paving|cobble|coping|threshold|thresholds|riser|risers|tread|treads|skirting|cladding|countertop|vanity|sill|sills|kerb|curb)\b|رخام|جرانيت|غرانيت|حجر|بازلت|ترافرتين|بلاط|عتب|عتبة|درج|وزرة|كسوة|تكسية|رصف|كوبنج|إفريز|افريز|كاونتر/i

// "90mm wide", "A: 100mm", "120 mm", "(b) 150 mm high", "Ref. ST-01"
const VARIANT_ONLY = /^\s*\(?(?:[a-z]|\d{1,2}|[ivx]{1,4})?\s*[).:\-–]?\s*(?:\d+(?:[.,]\d+)?\s*(?:mm|cm|m|مم|سم|م)\s*(?:wide|thick|thk|high|long|deep|dia|width|height|عرض|سماكة|ارتفاع|طول)?|ref\.?\s*[a-z]{1,4}[-\s]?\d+[a-z0-9-]*|type\s*[a-z0-9-]+|كود\s*:?\s*[a-z0-9-]+)\s*$/i

// "…installation of", "supply and install for", "توريد وتركيب" with nothing after it
const DANGLING_PARENT = /(?:\b(?:of|for|with|to|in)\s*[:\-–]?\s*$)|(?:(?:توريد|تركيب|تنفيذ)\s*(?:و\s*(?:توريد|تركيب|تنفيذ))?\s*$)/i

const wordsOf = (s: string) => s.trim().split(/\s+/).filter(Boolean)

/** A row that is a section/bill heading, not a line the customer asked for. */
export function sectionHeaderLikely(description: string, quantity: number, coveredNames: string[]): boolean {
  const d = (description || '').trim()
  if (!d) return false
  if (quantity > 0) return false
  const hay = d.toLowerCase()
  if (coveredNames.some((n) => n && hay.includes(n.toLowerCase()))) return false
  if (MATERIAL_WORD.test(d) && !HEADER_VOCAB.test(d)) return false
  if (HEADER_VOCAB.test(d) || HEADER_VOCAB_AR.test(d)) return true
  // Short, ALL-CAPS, no digits, no material word: "EXTERNAL CLADDING WORK"
  const letters = d.replace(/[^A-Za-z؀-ۿ]/g, '')
  const words = wordsOf(d)
  return words.length <= 5 && letters.length >= 4 && !/\d/.test(d) && d === d.toUpperCase() && /[A-Z]/.test(d)
}

/** A child variant that carries no material anywhere — the parent's spec was lost. */
export function orphanVariantLikely(description: string, details: string | null | undefined, coveredNames: string[]): boolean {
  const d = (description || '').trim()
  if (!d) return false
  const both = `${d} ${details || ''}`
  const hay = both.toLowerCase()
  if (coveredNames.some((n) => n && hay.includes(n.toLowerCase()))) return false
  if (MATERIAL_WORD.test(both)) return false
  return VARIANT_ONLY.test(d)
}

/** "Supply and installation of" and nothing else — a parent line without its children. */
export function danglingParentLikely(description: string, quantity: number): boolean {
  const d = (description || '').trim()
  if (!d || quantity > 0) return false
  return DANGLING_PARENT.test(d) || (wordsOf(d).length <= 3 && !MATERIAL_WORD.test(d) && !/\d/.test(d))
}

/**
 * Parse a per-zone breakdown written into details ("LIV 900, H1P 150, Toilet 1 5")
 * and compare its sum with the row quantity. Only fires on ≥2 labelled numbers.
 */
export function breakdownMismatch(details: string | null | undefined, quantity: number): { sum: number; parts: number } | null {
  const text = (details || '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
  if (!text || !(quantity > 0)) return null
  // A segment = short label + number; segments separated by commas / semicolons / bullets.
  const segs = text.split(/[,;،•|\n]+/).map((s) => s.trim()).filter(Boolean)
  const nums: number[] = []
  for (const seg of segs) {
    const m = /^([A-Za-z؀-ۿ][\w .\-؀-ۿ]{0,24}?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:m2|m²|sqm|m|lm|pcs|nos?|م2|م|عدد)?\s*$/i.exec(seg)
    if (!m) continue
    const label = m[1].trim()
    // Skip things that are attributes, not zones ("thickness 20", "size 600").
    if (/^(?:thickness|thk|size|finish|colour|color|ref|type|code|سماكة|مقاس|لون|فنش|كود|نوع)$/i.test(label)) continue
    const n = Number(m[2].replace(',', '.'))
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length < 2) return null
  const sum = Math.round(nums.reduce((a, b) => a + b, 0) * 1000) / 1000
  const diff = Math.abs(sum - quantity) / quantity
  return diff > 0.02 ? { sum, parts: nums.length } : null
}

export function validateRow(row: ValidatableRow, coveredNames: string[]): RowValidation {
  const marks: string[] = []
  if (sectionHeaderLikely(row.description, row.quantity, coveredNames)) {
    return { drop: true, dropReason: 'عنوان قسم/بيل — ليس بنداً قابلاً للتسعير', marks }
  }
  if (orphanVariantLikely(row.description, row.details, coveredNames)) {
    marks.push('بند فرعي بلا مادة/مواصفات البند الرئيسي (مثل "90mm wide") — أكمل الوصف من الـBOQ قبل التسعير')
  } else if (danglingParentLikely(row.description, row.quantity)) {
    marks.push('سطر ناقص — يبدو عنوان بند رئيسي بلا فرعياته/كميته، راجع الـBOQ')
  }
  const bd = breakdownMismatch(row.details, row.quantity)
  if (bd) marks.push(`تفصيل الغرف/المناطق يجمع ${bd.sum} لكن الكمية ${row.quantity} — تحقّق من الإجمالي`)
  return { drop: false, dropReason: null, marks }
}
