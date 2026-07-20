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

// Words that turn the material after them into CONTEXT rather than the product:
// what the stone is laid on, fixed to, or backed by. AGENTS.md's rule is "look
// at the head noun" — this is the practical read of it.
//
//   "Marble tile ON concrete screed"        → concrete is the substrate → marble
//   "Granite cladding ANCHORED TO concrete" → concrete is the structure → granite
//   "Precast Concrete Granite Cladding"     → nothing precedes it → concrete IS
//                                             the product → drop
const SUBSTRATE_PREPOSITIONS =
  /\b(on|onto|over|to|against|above|upon|with|behind|under|underneath|atop|fixed|bonded|anchored|laid|installed|mounted|bedded|backed|adhered)\b\s*(?:[a-z]+\s+){0,2}$|(?:على|فوق|إلى|الى|ضد|خلف|تحت|مع|مثبت|مثبتة|ملصق|ملصقة|مركب|مركبة|بطانة|قاعدة)\s*(?:\S+\s+){0,2}$/i

// A natural-stone word appearing BEFORE the disqualifier is strong evidence the
// stone is the head noun and the other material is context.
const STONE_WORD = /\b(marble|granite)\b|رخام|جرانيت/i

/**
 * Is this disqualifying word incidental — describing what the stone attaches to
 * rather than what the item IS?
 */
function isIncidental(text: string, matchIndex: number, matched: string): boolean {
  const before = text.slice(0, matchIndex)

  // Nothing before it → it leads the description → it IS the product.
  // ("Precast Concrete Granite Wall Cladding", "GRC Panel with granite finish")
  if (!before.trim()) return false

  // A stone word must appear before it, otherwise there's no stone to be the
  // head noun. ("Cement mortar on concrete" is not ours either way.)
  if (!STONE_WORD.test(before)) return false

  // …and it must be introduced as a substrate/fixing. "Marble concrete panel"
  // has a stone word before it but no preposition — that's a compound name, and
  // it stays disqualified.
  if (!SUBSTRATE_PREPOSITIONS.test(before)) return false

  // Never let a look-alike hide behind a preposition: "porcelain tile with
  // marble effect" must not survive because "with" precedes it.
  return !LOOK_ALIKE.test(text) && !/\b(precast|grc|gfrc|grg)\b/i.test(matched)
}

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
    const m = re.exec(text)
    if (!m) continue
    // The word is present — but is it the PRODUCT, or just what the stone sits
    // on? "Marble tile on concrete screed" is marble; the concrete is the floor
    // underneath it. Dropping that row loses a real sale, which is a worse
    // failure than the one this guard exists to prevent.
    if (isIncidental(text, m.index, m[0])) continue
    return {
      disqualified: true,
      realDepartment: department,
      reason: `كلمة مستبعِدة (${department}) — المنتج مصنّع، مو حجر طبيعي.`,
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

// Natural-stone MATERIAL words — bilingual. A row is "anchored" to the shop only
// if its own text names one of these OR a covered department from /settings. This
// is the deterministic answer to the real failure: a material-less fixture line
// ("Staff dining vanity counter — 1590×600×250 mm", "External stone rainscreen
// cladding") being priced as marble/granite just because department_match is a
// REQUIRED field the model had to fill with SOMETHING. Product/location nouns
// (counter, vanity, cladding, panel, rainscreen) are deliberately NOT anchors —
// they say nothing about the substance and are exactly how the ambiguous rows
// slip in. A bare "stone" is not an anchor either (cast stone, stone-effect…).
const STONE_MATERIALS = [
  'marble', 'granite', 'limestone', 'quartzite', 'quartz', 'onyx', 'travertine',
  'basalt', 'sandstone', 'slate', 'dolomite', 'porphyry', 'gabbro', 'terrazzo',
  'رخام', 'جرانيت', 'غرانيت', 'كوارتز', 'كوارتزايت', 'حجر جيري', 'ترافرتين',
  'ترافورتين', 'أونيكس', 'اونيكس', 'بازلت', 'حجر رملي', 'دولوميت',
]
// terrazzo/quartz appear here for ANCHORING only (the text talks about stone at
// all); the DISQUALIFYING pass above still drops engineered-quartz/terrazzo rows.

/**
 * Positive-anchor gate. A row survives only if it names a covered department
 * (from /settings, either language) OR a natural-stone material in its OWN text.
 * Rows that name neither are ambiguous non-stone lines — dropped, not priced.
 * `text` should be the description PLUS details (that's where the material sits).
 */
export function guardDepartmentAnchor(
  text: string,
  coveredDepartments: string[],
): GuardVerdict {
  const hay = (text || '').toLowerCase()
  if (!hay.trim()) {
    return { disqualified: true, realDepartment: null, reason: 'بند بلا وصف كافٍ — لا يمكن ربطه بقسم مغطّى.' }
  }
  // Data-driven: any covered department name (en/ar) written in the row.
  for (const d of coveredDepartments) {
    const t = (d || '').trim().toLowerCase()
    if (t.length >= 3 && hay.includes(t)) return CLEAN
  }
  // Fixed natural-stone lexicon — robust even if a /settings name is misspelled
  // (e.g. "Quartez") or the row uses the material word instead of the dept name.
  for (const m of STONE_MATERIALS) {
    if (hay.includes(m)) return CLEAN
  }
  return {
    disqualified: true,
    realDepartment: null,
    reason: 'البند لا يذكر أي مادة من أقسامك المغطّاة (مبهم) — لم يُسعّر.',
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
