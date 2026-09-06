// Deterministic catalogue matcher — shared by Furn's SUGGESTED pricing and
// Tannoor's auto-pricing.
//
// Given a BOQ line's text (description + details) and any attributes resolved
// from the project files, find the catalogue VARIANT (colour + finish +
// thickness + unit) it most likely is. It is a scorer, not an oracle: it never
// invents a match. Below the confidence threshold it returns null, and the
// caller treats the line as "needs a human" (Furn: no suggestion; Tannoor:
// is_missing). AGENTS.md: "No invented products. Never match on name alone."
//
// Pure and dependency-free so it runs on the server and in the test harness.

export interface CatalogVariant {
  id: string
  /** Base material / stone name(s) — English and Arabic joined. */
  name: string
  colours: string[]
  finish: string | null
  thickness_mm: number | null
  unit: string
  price_sar: number
  price_usd: number
  /** Covered department name if known (e.g. "Marble" / "Granite"). */
  department: string | null
}

export interface MatchHints {
  thickness_mm?: number | null
  finish?: string | null
  colour?: string | null
  material?: string | null
}

export interface MatchResult {
  product_id: string
  score: number
  /** Human-readable evidence (Arabic labels, verbatim values). */
  reasons: string[]
  variant: CatalogVariant
}

/** Accept a match only at or above this score AND with a name/colour anchor. */
export const MATCH_THRESHOLD = 0.6

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }

export function norm(s: string | null | undefined): string {
  return (s || '')
    .replace(/[٠-٩]/g, (d) => AR_DIGITS[d] ?? d)
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Words that say nothing about WHICH variant it is.
const STOP = new Set([
  'marble', 'granite', 'stone', 'natural', 'tile', 'tiles', 'slab', 'slabs', 'supply', 'install',
  'installation', 'and', 'of', 'the', 'for', 'with', 'to', 'in', 'mm', 'cm', 'm2', 'm', 'lm', 'pcs',
  'رخام', 'جرانيت', 'غرانيت', 'حجر', 'طبيعي', 'بلاط', 'توريد', 'تركيب', 'و', 'من', 'الى', 'في', 'مع', 'مم', 'سم',
])

export function tokens(s: string | null | undefined): string[] {
  return norm(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w))
}

// Finish synonyms → canonical key (bilingual, spelling-tolerant).
const FINISHES: Array<[string, RegExp]> = [
  ['polished', /polish|مصقول|لميع|لامع/],
  ['honed', /\bhoned\b|\bmatt\b|\bmatte\b|مطفي|مطفى|مطفيه/],
  ['flamed', /flame|مشعل|محروق/],
  ['bush-hammered', /bush\s*-?\s*hammer|مبوز|بوش|مطرق/],
  ['sandblasted', /sand\s*-?\s*blast|سفع\s*رملي|رملي/],
  ['shot-blasted', /shot\s*-?\s*blast|شوت\s*بلاست/],
  ['leathered', /leather|جلدي/],
  ['split-face', /split\s*-?\s*face|rough|خشن|split/],
  ['brushed', /brush|مفرش/],
  ['tumbled', /tumbl|مدحرج/],
]

export function canonFinish(s: string | null | undefined): string | null {
  const n = norm(s)
  if (!n) return null
  for (const [key, re] of FINISHES) if (re.test(n)) return key
  return null
}

function unitFamily(u: string): string {
  const n = norm(u).replace(/[²2]/g, '2')
  if (['m2', 'sqm', 'sm', 'م2', 'متر مربع'].includes(n)) return 'area'
  if (['m', 'lm', 'mt', 'rm', 'متر', 'م', 'مط', 'meter'].includes(n)) return 'length'
  if (['pcs', 'pc', 'no', 'nos', 'ea', 'unit', 'set', 'عدد', 'حبه', 'قطعه'].includes(n)) return 'count'
  return 'other'
}

const MATERIAL_WORDS: Array<[string, RegExp]> = [
  ['marble', /marble|رخام/],
  ['granite', /granit|جرانيت|غرانيت/],
]
function materialOf(s: string | null | undefined): string | null {
  const n = norm(s)
  for (const [k, re] of MATERIAL_WORDS) if (re.test(n)) return k
  return null
}

export function scoreVariant(text: string, hints: MatchHints, v: CatalogVariant): { score: number; reasons: string[]; anchored: boolean } {
  const t = norm(text)
  const reasons: string[] = []
  let score = 0
  let anchored = false

  // Name tokens (the stone's own name: "black galaxy", "saudi bianco", "carrara").
  const nameToks = Array.from(new Set(tokens(v.name)))
  if (nameToks.length > 0) {
    const hit = nameToks.filter((w) => t.includes(w))
    if (hit.length > 0) {
      score += 0.45 * (hit.length / nameToks.length)
      anchored = true
      reasons.push(`الاسم: ${hit.join(' ')}`)
    }
  }

  // Colour (catalogue colours, either language) or the resolved colour hint.
  const colourWords = v.colours.map(norm).filter(Boolean)
  const colourHit = colourWords.find((c) => t.includes(c) || (hints.colour && norm(hints.colour).includes(c)))
  if (colourHit) { score += 0.15; anchored = true; reasons.push(`اللون: ${colourHit}`) }

  // Finish — agreement helps, a KNOWN disagreement hurts (polished ≠ honed).
  const vf = canonFinish(v.finish)
  const tf = canonFinish(hints.finish) || canonFinish(text)
  if (vf && tf) {
    if (vf === tf) { score += 0.2; reasons.push(`الفنش: ${vf}`) }
    else score -= 0.25
  }

  // Thickness — exact agreement is a strong signal, a disagreement a strong veto.
  const th = hints.thickness_mm ?? null
  if (v.thickness_mm !== null && th !== null) {
    if (Math.abs(v.thickness_mm - th) <= 0.5) { score += 0.2; reasons.push(`السماكة: ${th}mm`) }
    else score -= 0.3
  }

  // Unit family (m² vs m vs pcs).
  const uf = unitFamily(v.unit)
  const hintUnit = /\bm2\b|م2|sqm/.test(t) ? 'area' : /\blm\b|\bm\b(?!m)|مط\b/.test(t) ? 'length' : null
  if (hintUnit && uf !== 'other') { if (hintUnit === uf) score += 0.05; else score -= 0.1 }

  // Material sanity: a granite variant must not be suggested for a marble line.
  const vm = materialOf(v.department) || materialOf(v.name)
  const tm = materialOf(hints.material) || materialOf(text)
  if (vm && tm && vm !== tm) score -= 0.5

  return { score: Math.max(0, Math.min(1, score)), reasons, anchored }
}

/** Best confident variant for a line, or null when nothing clears the bar. */
export function matchVariant(text: string, hints: MatchHints, catalog: CatalogVariant[]): MatchResult | null {
  let best: MatchResult | null = null
  for (const v of catalog) {
    const { score, reasons, anchored } = scoreVariant(text, hints, v)
    if (!anchored || score < MATCH_THRESHOLD) continue
    if (!best || score > best.score) best = { product_id: v.id, score, reasons, variant: v }
  }
  return best
}
