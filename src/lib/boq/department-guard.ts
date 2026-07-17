// The compound-name guard — SHARED by Furn and Tannoor.
//
// THE FAILURE IT EXISTS TO STOP (AGENTS.md calls it "a real failure mode from
// production", and the team hit it again independently — "بعض الأحيان يقول شبيه
// الجرانيت"): the word "granite" or "marble" appearing anywhere in a BOQ line
// does NOT mean the line is granite or marble.
//
//   "Precast Concrete Granite Wall Cladding"  → head noun is Precast Concrete
//   "GRC Panel with granite finish"           → GRC
//   "Terrazzo Marble Pattern Tile"            → Terrazzo
//   "Porcelain Granite-Effect Floor"          → Porcelain
//
// Quote any of those as stone and you've priced something you cannot supply.
//
// WHY THIS IS CODE AND NOT JUST A PROMPT RULE: the prompt already said all of
// this — in Furn only, and Tannoor never got it. Worse, when the model DID
// answer correctly (`department_match: "Concrete"`) the pipeline threw the
// answer away. A rule that lives only in a prompt is a rule that drifts between
// two copies and can be silently ignored by the model. This module is the
// backstop: deterministic, testable, and impossible for either engine to skip.
//
// It is intentionally CONSERVATIVE — it only fires on unambiguous manufactured-
// material words. Judgement calls stay with the model; this catches the ones
// that are never a judgement call.

// Words that mean "this is a manufactured product", regardless of what stone
// word sits next to them. Ordered roughly by how often they show up in real
// Saudi BOQs.
const DISQUALIFYING: Array<{ re: RegExp; department: string }> = [
  { re: /\bprecast\b|\bpre-cast\b|خرسانة\s*مسبقة|سابقة\s*الصب/i, department: 'Precast Concrete' },
  { re: /\bconcrete\b|\bخرسان/i, department: 'Concrete' },
  { re: /\bcast\s*stone\b|حجر\s*صناعي\s*مصبوب/i, department: 'Cast Stone' },
  { re: /\bg\.?r\.?c\b|\bgfrc\b|\bgrg\b/i, department: 'GRC' },
  { re: /\bterrazzo\b|تيرازو|ترازو/i, department: 'Terrazzo' },
  { re: /\bporcelain\b|بورسلين|بورسلان/i, department: 'Porcelain' },
  { re: /\bceramic\b|سيراميك/i, department: 'Ceramic' },
  { re: /\bagglomerat/i, department: 'Agglomerate' },
  { re: /\bsintered\b/i, department: 'Sintered Stone' },
  { re: /\bengineered\s*(stone|quartz)\b|\bquartz\s*(stone|surface|slab)\b|كوارتز/i, department: 'Engineered Quartz' },
  { re: /\bartificial\s*stone\b|\bfaux\b|\bsimulated\b|حجر\s*صناعي|صناعي\s*شبيه/i, department: 'Artificial Stone' },
  { re: /\bvinyl\b|\bh\.?p\.?l\b|\blaminate\b|فينيل|لامينيت/i, department: 'Vinyl/HPL' },
  { re: /\bcomposite\b|مركّب|كومبوزيت/i, department: 'Composite' },
  { re: /\bgypsum\b|\bجبس/i, department: 'Gypsum' },
]

// "…-look", "…-effect", "…finish": the stone word describes an APPEARANCE, not
// the substance. `granite-effect porcelain` is caught by DISQUALIFYING above;
// this catches `granite-look tile` where no manufactured word is named at all.
// Arabic conjugates: يشبه (m.) / تشبه (f.) / شبيه / شبيهة / مشابه — a BOQ writer
// uses whichever agrees with the noun, so match the stem, not one form. Missing
// تشبه is exactly how "ألواح تشبه الرخام" would have sailed through as marble.
// Arabic glues its prepositions onto the noun: "شبيهة بالرخام", "مشابهة للجرانيت".
// Matching a bare "رخام" after the verb misses both, so the connector allows the
// usual clitics (بال / لل / كال / ال / ب / ل / ك).
const AR_STONE = /(?:بال|كال|لل|ال|[بلك])?\s*(?:رخام|جرانيت|حجر)/.source
const LOOK_ALIKE = new RegExp(
  [
    // "granite-look", "marble effect", "رخام نمط"
    String.raw`\b(marble|granite|رخام|جرانيت)\s*[-–]?\s*(look|effect|finish|pattern|style|texture|مظهر|نمط)\b`,
    // "look-like marble", "effect granite"
    String.raw`\b(look|effect|pattern|style)\s*[-–]?\s*(like)?\s*(marble|granite)\b`,
    // "شبيه/شبيهة/يشبه/تشبه/مشابه/تقليد/يحاكي" + (بال|لل|…)? + رخام/جرانيت/حجر
    String.raw`(?:شبيه|شبيهة|[يت]شبه|مشابه|مشابهة|تقليد|يحاكي|محاكاة)\s*` + AR_STONE,
  ].join('|'),
  'i',
)

export interface GuardVerdict {
  /** true = this line is NOT natural stone and must not be quoted as ours. */
  disqualified: boolean
  /** The department it actually belongs to — feeds detected_departments[]. */
  realDepartment: string | null
  /** Human-readable why, in Arabic, for the audit trail. */
  reason: string | null
}

const CLEAN: GuardVerdict = { disqualified: false, realDepartment: null, reason: null }

/**
 * Decide whether a BOQ description is a manufactured look-alike rather than
 * natural stone. Runs on the description the AI returns, BEFORE we let the row
 * into the items table.
 */
export function guardDescription(description: string): GuardVerdict {
  const text = (description || '').trim()
  if (!text) return CLEAN

  for (const { re, department } of DISQUALIFYING) {
    if (re.test(text)) {
      return {
        disqualified: true,
        realDepartment: department,
        reason: `كلمة مستبعِدة (${department}) — المنتج مصنّع، مو حجر طبيعي.`,
      }
    }
  }

  if (LOOK_ALIKE.test(text)) {
    return {
      disqualified: true,
      realDepartment: 'Look-alike / Imitation',
      reason: 'الوصف يشير لمظهر يشبه الحجر (look/effect/شبيه) لا لحجر طبيعي.',
    }
  }

  return CLEAN
}

/**
 * Second gate: the model names the department itself (`department_match`). If it
 * says anything outside our covered list, believe it and drop the row — that is
 * the model telling us "this isn't yours", and the old pipeline deleted that
 * answer instead of acting on it.
 *
 * Comparison is case-insensitive because the model returns "Marble"/"marble"
 * interchangeably and AGENTS.md's own dedupe rule was case-sensitive.
 */
export function guardDepartmentMatch(
  departmentMatch: string | null | undefined,
  coveredDepartments: string[],
): GuardVerdict {
  const claimed = (departmentMatch || '').trim()
  if (!claimed) return CLEAN // nothing claimed — leave it to the description guard

  const covered = coveredDepartments.map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (covered.length === 0) return CLEAN // no catalog to compare against

  if (covered.includes(claimed.toLowerCase())) return CLEAN

  return {
    disqualified: true,
    realDepartment: claimed,
    reason: `الذكاء صنّفه "${claimed}" وهو خارج أقسامنا.`,
  }
}

/** Both gates. A row survives only if neither fires. */
export function guardItem(
  description: string,
  departmentMatch: string | null | undefined,
  coveredDepartments: string[],
): GuardVerdict {
  const byDescription = guardDescription(description)
  if (byDescription.disqualified) return byDescription
  return guardDepartmentMatch(departmentMatch, coveredDepartments)
}
