// Deterministic gates of the BOQ router — the promises that must never drift.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thicknessFromText, detailsStateThickness, readingVerifies, attrsVerify, mergeAttrs, numbersIn, EMPTY_ATTRS } from '@/lib/boq/router/core'
import { isClearlyOutOfScope, guardDescription, stoneContextAnchor, isCodeOnlyStone } from '@/lib/boq/department-guard'

test('thicknessFromText: real BOQ phrases (sizes/widths/joints are NOT thickness)', () => {
  const cases: Array<[string, number | null]> = [
    ['Supply and install for stair 30mm THK Saudi Bianco Granite', 30],
    ['stair landing 30mmTHK Saudi Bianco Granite Tiles', 30],
    ['20 mm thick terrazzo floor finish, with rectified cuts', 20],
    ['natural Riyadh Rough Stone, 40 mm thick, with natural split-face finish', 40],
    ['NATURAL STONE COBBLE TILES 600x600mm WITH 5mm GROUTING', null],
    ['NATURAL STONE COBBLE 300x1200mm HIGH CISTERN WALL', null],
    ['Granite Setts 100mmx100mm', null],
    ['Tiles 600 x 600 x 20 mm', 20],
    ['سماكة ٣ سم', 30],
    ['سمك 20 مم', 20],
    ['90mm wide', null],
    ['120mm wide', null],
    ['Interlock Paving 80mm thick', 80],
    ['thickness: 20 mm', 20],
    ['Sand blasted - 750 mm x 375 mm x 100 mm - Riyadh limestone', 100],
    ['Shot blasted - 200 mm x 50 mm x 100 mm - Concrete paver', 100],
    ['Shot blasted - 100 mm x 100 mm x 80 mm - Concrete paver - Beige', 80],
    ['R10 slip resistance, Ref. ST-01', null],
    ['Marble tile 30 mm, polished, Carrara', 30],
    ['Coping 3 cm', 30],
    ['Stone 2400mm high wall', null],
    ['6mm joint', null],
    ['600 x 1200 x 20mm honed', 20],
  ]
  for (const [text, expected] of cases) assert.equal(thicknessFromText(text), expected, text)
  assert.equal(detailsStateThickness('20mm – polished'), true)
  assert.equal(detailsStateThickness('600x600mm polished'), false)
})

test('readingVerifies: the quantity hallucination gate', () => {
  const page = 'Lobby marble flooring ........ 1,412 m2\nCorridor granite 168 m2'
  assert.equal(readingVerifies(page, 'Corridor granite 168 m2', 168), true)
  assert.equal(readingVerifies(page, 'Lobby marble flooring 412 m2', 412), false, '412 is only a substring of 1,412')
  assert.equal(readingVerifies(page, 'Lobby marble flooring ........ 1,412 m2', 1412), true)
  assert.equal(readingVerifies(page, 'invented quote 999', 999), false)
  assert.deepEqual(numbersIn('1,412 sqm and 20.5 mm'), [1412, 20.5])
  // A unit like "m2" contributes its digit — harmless for the gate (a claimed
  // value must ALSO appear inside its own quote), documented here on purpose.
  assert.deepEqual(numbersIn('412 m2'), [412, 2])
})

test('attrsVerify: every quoted fragment must exist; thickness must be a real page number', () => {
  const page = 'Type ST-01: Carrara White marble, honed finish, 20 mm thick, 600x600'
  assert.equal(attrsVerify(page, 'honed finish | 20 mm thick', { ...EMPTY_ATTRS, finish: 'honed', thickness_mm: 20 }), true)
  assert.equal(attrsVerify(page, 'polished finish', { ...EMPTY_ATTRS, finish: 'polished' }), false, 'fragment not on page')
  assert.equal(attrsVerify(page, 'honed finish', { ...EMPTY_ATTRS, thickness_mm: 30 }), false, '30 is not on the page')
  assert.equal(attrsVerify('Coping 3 cm thick', '3 cm thick', { ...EMPTY_ATTRS, thickness_mm: 30 }), true, 'cm form accepted')
})

test('mergeAttrs: first writer wins per field, later pages fill gaps', () => {
  const a = { ...EMPTY_ATTRS, finish: 'polished' }
  const b = { ...EMPTY_ATTRS, finish: 'honed', thickness_mm: 20 }
  assert.deepEqual(mergeAttrs(a, b), { ...EMPTY_ATTRS, finish: 'polished', thickness_mm: 20 })
})

test('isClearlyOutOfScope: drop the obvious, flag the doubtful (owner rule)', () => {
  const covered = ['Marble', 'Granite', 'رخام', 'جرانيت']
  const cases: Array<[string, string, boolean]> = [
    ['Precast Concrete Granite Wall Cladding', 'Precast Concrete', true],
    ['Agglotech Ivory terrazzo, Ref. ST-01', 'Terrazzo', true],
    ['Granite Setts Shot blasted Lunar Grey Material: Granite', 'Precast Concrete', false],
    ['Pea gravel, natural rounded', 'Gravel', true],
    ['Natural limestone coping 30mm', 'Limestone', false],
    ['Marble tile on concrete screed', 'Marble', false],
    ['Exposed aggregates concrete paving', 'Concrete', true],
    ['Interlock Paving 80mm thick', 'Precast Concrete', true],
    ['granite-look porcelain tile', 'Porcelain', true],
    ['Natural Basalt Stone Cladding dark grey', 'Basalt', false],
    ['Omani Stone Stair - Tread', 'Natural Stone', false],
    ['Supply and install for stair 30mm THK Saudi Bianco Granite', 'Granite', false],
    ['Terrazzo Marble Pattern Tile', 'Marble', true],
  ]
  for (const [text, dept, expected] of cases) assert.equal(isClearlyOutOfScope(text, dept, covered), expected, text)
  assert.equal(guardDescription('Marble tile on concrete screed').disqualified, false)
  assert.equal(guardDescription('ألواح تشبه الرخام').disqualified, true)
})

test('vanity-top package: a stone code or a stone package keeps the row (flagged), never drops it', () => {
  const covered = ['Marble', 'Granite', 'رخام', 'جرانيت']
  const vanity = 'Vanity counter unit with bottom self; type ST-02+WD-01; dimesion 1425 x 600 x 525mm; to fit to 1 basin; as Drg. AID-00-8022'
  // The model said "Joinery" (WOOD WORK heading) — the ST code is a stone anchor.
  assert.equal(isClearlyOutOfScope(vanity, 'Joinery', covered), false)
  assert.equal(isCodeOnlyStone(vanity, covered), true, 'material unknown → must be flagged for the legend')
  // Joinery ONLY (no stone code) in a plain package is still out.
  assert.equal(isClearlyOutOfScope('Wardrobe unit; type WD-01; 2400 x 600 x 2100mm', 'Joinery', covered), true)
  // …but inside a stone package the model's label alone never drops it.
  assert.equal(isClearlyOutOfScope('Wardrobe unit; type WD-01; 2400 x 600 x 2100mm', 'Joinery', covered, { contextAnchored: true }), false)
  // Evidence in the row's own words still wins even in a stone package.
  assert.equal(isClearlyOutOfScope('Precast concrete coping', 'Precast Concrete', covered, { contextAnchored: true }), true)
  assert.equal(stoneContextAnchor(['Vanity Top BOQ.xlsx']), true)
  assert.equal(stoneContextAnchor(['Vanity-Top-BOQ-oegbcf.xlsx', 'supply vanity counter units']), true)
  assert.equal(stoneContextAnchor(['MEP Package.xlsx', 'supply HVAC units']), false)
  assert.equal(stoneContextAnchor(['أعمال رخام الفلل']), true)
})

test('"or similar approved" on a manufactured product keeps the row (substitute opportunity)', async () => {
  const { allowsSubstitute } = await import('@/lib/boq/department-guard')
  const covered = ['Marble', 'Granite', 'Limestone']
  const tobermore = 'Tobermore Braemar (or similar approved), ground finish, jura grey colour, laid in herringbone – Size 100 x 200 x 80mm thick'
  assert.equal(allowsSubstitute(tobermore), true)
  assert.equal(isClearlyOutOfScope(tobermore, 'Concrete', covered), false, 'kept + flagged, not dropped')
  assert.equal(isClearlyOutOfScope('Tobermore Braemar block paving 80mm', 'Concrete', covered), true, 'no substitute clause → still out')
  assert.equal(allowsSubstitute('بلاط خرساني أو ما يعادله'), true)
  assert.equal(allowsSubstitute('Chedworth Limestone, sawn finish'), false)
})
