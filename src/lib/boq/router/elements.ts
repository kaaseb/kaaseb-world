// The STONE ELEMENT taxonomy — every shape a natural-stone item takes in a BOQ,
// bilingual, with how each one is read.
//
// Why: the model recognised "marble flooring" and missed "vanity counter unit
// ST-02", would call a "reception desk with stone top" joinery, and read a
// "stair" as one line when it is treads + risers + landings + nosing. An
// estimator carries this list in their head; here it is written down once and
// used three ways:
//   • injected into phase 1 (ELEMENT_PLAYBOOK) so every family is recognised
//     under any of its names, with its unit convention and what is ours in a
//     composite (the top of a table, the treads of a stair, the cladding of a
//     column);
//   • `elementOf()` tags a row deterministically for unit sanity (a counter
//     top in m³ is a mistake, a balustrade in m² is one too);
//   • a few families are stone BY DEFINITION (a counter top, a tread, a
//     mosaic) and anchor a row even when no material word is written.
//
// Pure; covered by tests/elements.test.ts.

export type ElementFamily =
  | 'flooring' | 'wall_cladding' | 'facade' | 'paving' | 'setts' | 'kerb' | 'coping' | 'stair'
  | 'skirting' | 'threshold' | 'sill' | 'countertop' | 'desk' | 'table' | 'bench' | 'basin' | 'bath'
  | 'shower' | 'niche' | 'column' | 'arch' | 'moulding' | 'fireplace' | 'mosaic' | 'border' | 'plinth'
  | 'balustrade' | 'cap' | 'step' | 'ramp' | 'lettering' | 'sculpture' | 'grave' | 'mihrab' | 'screen'
  | 'pool' | 'planter' | 'fountain' | 'door_surround' | 'lintel' | 'backsplash' | 'slab_raw' | 'block'
  | 'tile' | 'pebble'

export interface ElementDef {
  family: ElementFamily
  /** Names as they appear in BOQs — English and Arabic, singular/plural stems. */
  names: string[]
  /** Units this element is normally measured in (first = most common). */
  units: string[]
  /** true: the element is a stone product by definition — anchors a row without a material word. */
  stoneByDefinition: boolean
  /** How an estimator reads it (one line, goes to the model). */
  read: string
}

const D = (family: ElementFamily, names: string[], units: string[], stoneByDefinition: boolean, read: string): ElementDef =>
  ({ family, names, units, stoneByDefinition, read })

export const ELEMENTS: ElementDef[] = [
  D('flooring', ['flooring', 'floor tile', 'floor finish', 'floor slab', 'أرضيات', 'ارضيات', 'بلاط أرضيات', 'بلاط ارضيات'], ['m2'], false,
    'area in m²; tile module and thickness in details; lobby/corridor/room name is a location, not a spec.'),
  D('wall_cladding', ['wall cladding', 'cladding', 'wall lining', 'wall finish', 'wall tile', 'dado', 'wainscot', 'تكسية', 'كسوة', 'تلبيس', 'كسوة جدران', 'تكسية جدران'], ['m2'], false,
    'area in m²; internal vs external and fixing method (adhesive / mechanical) matter for price.'),
  D('facade', ['facade', 'façade', 'external cladding', 'rainscreen', 'curtain stone', 'واجهة', 'واجهات', 'تكسية خارجية'], ['m2'], false,
    'area in m²; thickness 30–40 mm typical; anchors/sub-frame are usually a separate line.'),
  D('paving', ['paving', 'paver', 'pavers', 'paving slab', 'flag', 'flagstone', 'hardscape', 'رصف', 'بلاط خارجي', 'انترلوك حجري', 'بلاطات رصف'], ['m2'], false,
    'area in m²; "type N" rows each become one item; pattern (stretcher/herringbone) is a spec, not a quantity.'),
  D('setts', ['setts', 'sett', 'cobble', 'cobbles', 'cobblestone', 'cube', 'cubes', 'حصى مكعب', 'كوبل', 'مكعبات حجرية'], ['m2', 'ton', 'pcs'], false,
    'usually m²; sometimes tonnes or pieces — keep the customer unit and say the size (100x100x100).'),
  D('kerb', ['kerb', 'curb', 'kerbstone', 'edging', 'edge restraint', 'بردورة', 'بردورات', 'كيرب', 'حجر حافة'], ['m', 'lm', 'pcs'], false,
    'length in lm; section (e.g. 150x300) and radius pieces in details.'),
  D('coping', ['coping', 'copings', 'wall coping', 'capping', 'كوبنج', 'كوبينج', 'غطاء جدار', 'تاج جدار'], ['m', 'lm'], true,
    'length in lm; width/thickness/drip in details; a coping is a stone piece by definition.'),
  D('stair', ['stair', 'stairs', 'staircase', 'tread', 'treads', 'riser', 'risers', 'landing', 'nosing', 'stringer', 'step', 'steps', 'درج', 'سلم', 'سلالم', 'درجة', 'درجات', 'نائم', 'قائم', 'بسطة', 'بسطات'], ['m', 'lm', 'pcs', 'm2'], true,
    'a stair is several items: treads (lm or Nr), risers (lm or Nr), landings (m²), nosing/anti-slip grooves (lm). Never one line "stair"; if the BOQ gives one line, keep it and say what is missing.'),
  D('skirting', ['skirting', 'skirtings', 'base', 'baseboard', 'وزرة', 'وزرات', 'نعلة', 'إزار'], ['m', 'lm'], false,
    'length in lm; height (100/150 mm) and thickness in details.'),
  D('threshold', ['threshold', 'thresholds', 'saddle', 'door sill', 'عتبة', 'عتبات', 'عتبة باب'], ['pcs', 'm', 'lm'], true,
    'Nr or lm; width × length × thickness per piece; by definition a stone piece.'),
  D('sill', ['sill', 'sills', 'window sill', 'cill', 'جلسة', 'جلسات', 'جلسة شباك', 'عتبة شباك'], ['m', 'lm', 'pcs'], true,
    'lm or Nr; projection and drip in details.'),
  D('countertop', ['countertop', 'counter top', 'counter-top', 'worktop', 'work top', 'vanity top', 'vanity counter', 'vanity unit', 'vanity', 'kitchen top', 'bar top', 'bar counter', 'island', 'kitchen island', 'top', 'كاونتر', 'سطح مغسلة', 'سطح مغاسل', 'مغسلة', 'مغاسل', 'سطح مطبخ', 'رخام مطبخ', 'بار'], ['pcs', 'm2', 'm', 'lm'], true,
    'a slab by definition. Given as Nr with L×W×H: the top is L×W (H is the cabinet) — keep Nr and add the area per piece; basin cut-outs, edge profile (bullnose/mitred/waterfall) and upstand/backsplash are priced extras. In a composite unit (ST-02+WD-01) the top is ours, the carcass is not.'),
  D('desk', ['reception desk', 'reception counter', 'desk', 'كاونتر استقبال', 'طاولة استقبال', 'مكتب استقبال'], ['pcs', 'm2', 'lm'], false,
    'ours for the stone top and stone cladding of the front; the structure is joinery/metal — say which parts.'),
  D('table', ['table', 'tables', 'table top', 'dining table', 'coffee table', 'side table', 'طاولة', 'طاولات', 'سطح طاولة'], ['pcs'], false,
    'Nr; the stone TOP is ours (size × thickness, edge profile); legs/base only if stated as stone.'),
  D('bench', ['bench', 'benches', 'seating', 'seat', 'seat wall', 'bench top', 'مقعد', 'مقاعد', 'كرسي حجري', 'كراسي حجرية', 'جلسة خارجية'], ['pcs', 'm', 'lm'], false,
    'Nr or lm; solid stone bench vs stone-clad concrete bench vs stone seat on a steel frame — read which; only the stone is ours.'),
  D('basin', ['basin', 'wash basin', 'washbasin', 'sink', 'carved basin', 'stone basin', 'حوض', 'أحواض', 'مغسلة منحوتة', 'حوض رخام'], ['pcs'], false,
    'Nr; a carved/solid stone basin is ours; a ceramic basin dropped into our top is not.'),
  D('bath', ['bathtub', 'bath tub', 'tub', 'حوض استحمام', 'بانيو'], ['pcs'], false, 'Nr; solid stone tubs only.'),
  D('shower', ['shower tray', 'shower base', 'shower floor', 'قاعدة دش', 'صينية دش', 'أرضية دش'], ['pcs', 'm2'], false, 'Nr or m²; slope/drain cut in details.'),
  D('niche', ['niche', 'niches', 'recess', 'shelf', 'shelves', 'نيش', 'فتحة جدارية', 'رف', 'رفوف'], ['pcs', 'm', 'lm'], false, 'Nr or lm of shelf; mitred corners are a cutting extra.'),
  D('column', ['column', 'columns', 'pillar', 'pilaster', 'column cladding', 'عمود', 'أعمدة', 'اعمدة', 'تكسية أعمدة'], ['m2', 'pcs', 'm'], false,
    'cladding in m² (circumference × height) or Nr for solid/turned columns; capital and base are separate pieces.'),
  D('arch', ['arch', 'arches', 'archway', 'voussoir', 'keystone', 'قوس', 'أقواس', 'اقواس'], ['pcs', 'm', 'lm'], false, 'Nr or lm along the arc; cut-to-shape pieces.'),
  D('moulding', ['moulding', 'molding', 'cornice', 'profile', 'profiles', 'band', 'string course', 'dentil', 'ogee', 'bullnose profile', 'كورنيش', 'كرانيش', 'إفريز', 'افريز', 'بروفايل', 'زخرفة', 'حلية'], ['m', 'lm'], false, 'lm; profile drawing/section governs; machine profiling is a cutting operation.'),
  D('fireplace', ['fireplace', 'fire surround', 'hearth', 'mantel', 'mantelpiece', 'مدفأة', 'مدفئة', 'موقد'], ['pcs', 'set'], false, 'Nr/set; hearth + surround + mantel pieces.'),
  D('mosaic', ['mosaic', 'medallion', 'inlay', 'water jet', 'waterjet', 'water-jet', 'marquetry', 'rosette', 'pattern insert', 'موزاييك', 'فسيفساء', 'ميداليون', 'مدالية', 'ووتر جت', 'تطعيم'], ['pcs', 'm2'], true,
    'Nr or m²; a stone craft by definition; the design drawing governs; price is mostly cutting.'),
  D('border', ['border', 'borders', 'band', 'bands', 'strip', 'strips', 'listello', 'frame', 'إطار', 'حزام', 'شريط', 'كنار'], ['m', 'lm'], false, 'lm; width in details; often a different stone than the field.'),
  D('plinth', ['plinth', 'pedestal', 'base block', 'قاعدة', 'قواعد', 'بديستال'], ['pcs', 'm', 'lm'], false, 'Nr or lm.'),
  D('balustrade', ['balustrade', 'baluster', 'balusters', 'handrail', 'railing', 'parapet', 'newel', 'درابزين', 'درابزينات', 'بلستر', 'حاجز'], ['m', 'lm', 'pcs'], false,
    'lm of run or Nr of balusters + lm of handrail + Nr of newels; turned pieces are per piece.'),
  D('cap', ['pier cap', 'wall cap', 'gate pier cap', 'cap', 'caps', 'finial', 'غطاء عمود', 'تاج', 'أغطية'], ['pcs'], false, 'Nr; size and pitch.'),
  D('step', ['entrance step', 'external step', 'stone step', 'درجة مدخل', 'درجات خارجية'], ['pcs', 'm', 'lm'], true, 'Nr or lm; solid steps by definition stone.'),
  D('ramp', ['ramp', 'ramps', 'منحدر', 'منحدرات'], ['m2'], false, 'm²; anti-slip finish in details.'),
  D('lettering', ['lettering', 'letters', 'engraving', 'engraved', 'signage', 'sign', 'plaque', 'نقش', 'حفر', 'لوحة اسم', 'حروف'], ['pcs', 'set'], false, 'Nr/set; engraving is per letter or per plaque.'),
  D('sculpture', ['sculpture', 'statue', 'carving', 'carved', 'relief', 'منحوتة', 'نحت', 'تمثال'], ['pcs'], false, 'Nr; artwork — quote on drawing only.'),
  D('grave', ['headstone', 'gravestone', 'tombstone', 'grave', 'memorial', 'شاهد قبر', 'شواهد', 'قبر'], ['pcs'], true, 'Nr.'),
  D('mihrab', ['mihrab', 'qibla wall', 'minbar', 'محراب', 'قبلة', 'منبر'], ['pcs', 'm2'], false, 'Nr or m²; carved work — drawing governs.'),
  D('screen', ['screen', 'jali', 'lattice', 'mashrabiya', 'perforated panel', 'مشربية', 'مشربيات', 'شبك حجري', 'حاجز مثقب'], ['m2', 'pcs'], false, 'm² or Nr; water-jet perforation is the cost.'),
  D('pool', ['pool coping', 'pool deck', 'pool edge', 'pool surround', 'كوبنج مسبح', 'حافة مسبح', 'أرضية مسبح'], ['m', 'lm', 'm2'], false, 'lm of coping + m² of deck; bullnose/drop edge in details; anti-slip.'),
  D('planter', ['planter', 'planters', 'plant box', 'أحواض زراعة', 'حوض زراعة', 'مزهرية'], ['pcs', 'm', 'lm'], false, 'Nr or lm of cladding; solid vs clad.'),
  D('fountain', ['fountain', 'water feature', 'water wall', 'basin wall', 'نافورة', 'نافورات', 'شلال', 'جدار مائي'], ['pcs', 'm2', 'set'], false, 'set/Nr or m² cladding; drawing governs.'),
  D('door_surround', ['door surround', 'door frame', 'jamb', 'jambs', 'architrave', 'portal', 'إطار باب', 'حلق باب', 'قوصرة'], ['m', 'lm', 'set'], false, 'lm or set; head + 2 jambs.'),
  D('lintel', ['lintel', 'lintels', 'header', 'عتب علوي', 'عتب', 'ساكف'], ['pcs', 'm', 'lm'], false, 'Nr or lm; structural span in details.'),
  D('backsplash', ['backsplash', 'splashback', 'upstand', 'up-stand', 'واجهة خلفية', 'حافة خلفية', 'ظهر كاونتر'], ['m', 'lm', 'm2'], false, 'lm or m²; height in details; usually same stone as the top.'),
  D('slab_raw', ['slab', 'slabs', 'raw slab', 'block slab', 'بلاطة', 'بلاطات', 'ألواح', 'الواح', 'لوح'], ['m2', 'pcs'], false, 'm² or Nr of slabs; slab size (e.g. 2800x1600) and thickness.'),
  D('block', ['block', 'blocks', 'raw block', 'quarry block', 'بلوك', 'بلوكات', 'كتلة'], ['m3', 'ton'], false, 'm³ or tonnes — the ONLY stone items normally in m³.'),
  D('tile', ['tile', 'tiles', 'بلاط', 'بلاطات'], ['m2'], false, 'm²; module size and thickness in details.'),
  D('pebble', ['pebble', 'pebbles', 'gravel', 'aggregate', 'chippings', 'crushed stone', 'حصى', 'زلط', 'بحص', 'كسر رخام'], ['ton', 'm3', 'm2', 'bag'], false,
    'tonnes/m³/bags; decorative stone but usually a landscape supplier\'s line — keep, flag as a business decision.'),
]

const norm = (s: string) => (s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')

// Longest names first so "vanity top" wins over "top", "pool coping" over "coping".
const NAME_INDEX: Array<{ family: ElementFamily; name: string; re: RegExp }> = ELEMENTS
  .flatMap((d) => d.names.map((n) => ({ family: d.family, name: norm(n) })))
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ family, name }) => ({
    family, name,
    re: /[a-z]/.test(name) ? new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i') : new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  }))

/** The element family a row describes, or null. Longest name wins. */
export function elementOf(text: string | null | undefined): ElementFamily | null {
  const t = norm(text || '')
  if (!t) return null
  for (const e of NAME_INDEX) if (e.re.test(t)) return e.family
  return null
}

const DEFS = new Map(ELEMENTS.map((d) => [d.family, d]))

/** Stone by definition (counter top, tread, coping, mosaic…) — anchors a row. */
export function isStoneByDefinition(text: string | null | undefined): boolean {
  const f = elementOf(text)
  return !!f && !!DEFS.get(f)?.stoneByDefinition
}

const unitFamily = (u: string) => {
  const n = (u || '').toLowerCase().replace(/[²]/g, '2').replace(/[³]/g, '3').trim()
  if (['m', 'lm', 'mt', 'rm', 'متر', 'م', 'مط'].includes(n)) return 'm'
  if (['m2', 'sqm', 'sm', 'م2'].includes(n)) return 'm2'
  if (['m3', 'cbm', 'م3'].includes(n)) return 'm3'
  if (['pcs', 'pc', 'no', 'no.', 'nos', 'nr', 'ea', 'unit', 'عدد', 'حبة', 'قطعة'].includes(n)) return 'pcs'
  if (['set', 'sets', 'طقم'].includes(n)) return 'set'
  if (['kg', 'ton', 'tonne', 'tons', 'كجم', 'طن'].includes(n)) return 'ton'
  if (['bag', 'bags', 'كيس'].includes(n)) return 'bag'
  return n
}

/** A unit that cannot be right for this element (a counter top in m³, a
 *  balustrade in m²) — a review mark, never a silent conversion. */
export function unitSanity(text: string | null | undefined, unit: string): string | null {
  const f = elementOf(text)
  if (!f) return null
  const def = DEFS.get(f)!
  const u = unitFamily(unit)
  if (!u) return null
  const ok = def.units.map(unitFamily)
  // m³ is only ever right for raw blocks / gravel; pieces and sets are broadly acceptable.
  if (u === 'm3' && !ok.includes('m3')) return `الوحدة m³ غير معتادة لـ${f === 'countertop' ? 'الأسطح' : 'هذا العنصر'} (المعتاد: ${def.units.join(' / ')}) — تحقّق`
  if (ok.includes(u) || u === 'pcs' || u === 'set' || u === 'lot') return null
  return `الوحدة "${unit}" غير معتادة لهذا العنصر (المعتاد: ${def.units.join(' / ')}) — تحقّق من الـBOQ`
}

/** Compact playbook block for the phase-1 prompt. */
export const ELEMENT_PLAYBOOK = `
STONE ELEMENTS — recognise each under ANY of its names (English/Arabic), read it as an estimator does:
${ELEMENTS.map((d) => `- ${d.family.replace('_', ' ')} [${d.names.slice(0, 5).join(', ')}] — unit ${d.units.join('/')}. ${d.read}`).join('\n')}
COMPOSITES: the stone part of a furniture/joinery/metal item is OURS (a table top, a desk front, a bench seat, a stair's treads, a column's cladding, a basin carved from stone). Emit the stone part as the item, name the non-stone part in details as not ours. Never drop the row because its head noun is "table" or "unit".`
