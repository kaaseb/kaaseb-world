// The stone-element taxonomy: recognition under any name, stone-by-definition
// anchors, and unit sanity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elementOf, isStoneByDefinition, unitSanity, ELEMENTS } from '@/lib/boq/router/elements'

test('elementOf: longest name wins, bilingual', () => {
  assert.equal(elementOf('Vanity counter unit with bottom self; type ST-02+WD-01'), 'countertop')
  assert.equal(elementOf('Pool coping 40mm bullnose'), 'pool')
  assert.equal(elementOf('Wall coping 300 wide'), 'coping')
  assert.equal(elementOf('Marble treads and risers to main stair'), 'stair')
  assert.equal(elementOf('درج رخام للمدخل الرئيسي'), 'stair')
  assert.equal(elementOf('كاونتر استقبال رخام'), 'desk')
  assert.equal(elementOf('سطح مغسلة رخام 20 مم'), 'countertop')
  assert.equal(elementOf('Reception desk with stone top'), 'desk')
  assert.equal(elementOf('Dining table top Carrara 30mm'), 'table')
  assert.equal(elementOf('Water-jet medallion 2.4m dia'), 'mosaic')
  assert.equal(elementOf('External stone rainscreen cladding'), 'facade')
  assert.equal(elementOf('Chedworth Limestone, sawn finish – Paving type 1'), 'paving')
  assert.equal(elementOf('Supply of raw blocks'), 'block')
  assert.equal(elementOf('Structural steel beam'), null)
})

test('isStoneByDefinition: tops, treads, copings, thresholds, mosaics anchor; tables/benches do not', () => {
  assert.equal(isStoneByDefinition('Vanity top 1425 x 600'), true)
  assert.equal(isStoneByDefinition('Threshold 900 x 150 x 20'), true)
  assert.equal(isStoneByDefinition('Waterjet inlay to lobby floor'), true)
  assert.equal(isStoneByDefinition('Coffee table'), false)
  assert.equal(isStoneByDefinition('Garden bench'), false)
})

test('unitSanity: m³ on a counter top is wrong, lm on skirting is fine, blocks in m³ are fine', () => {
  assert.ok(unitSanity('Kitchen countertop 30mm', 'm3'))
  assert.equal(unitSanity('Marble skirting 100mm', 'lm'), null)
  assert.equal(unitSanity('Raw quarry blocks', 'm3'), null)
  assert.ok(unitSanity('Balustrade with turned balusters', 'm2'))
  assert.equal(unitSanity('Paving type 3 setts', 'm2'), null)
  assert.equal(unitSanity('Unknown thing', 'm3'), null, 'no element → no opinion')
})

test('taxonomy is well-formed', () => {
  const families = new Set(ELEMENTS.map((e) => e.family))
  assert.equal(families.size, ELEMENTS.length, 'no duplicate family')
  for (const e of ELEMENTS) { assert.ok(e.names.length >= 2, e.family); assert.ok(e.units.length >= 1, e.family) }
})
