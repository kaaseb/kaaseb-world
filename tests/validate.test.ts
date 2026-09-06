// Structural validators — the shapes seen in the owner's real BOQs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateRow, sectionHeaderLikely, orphanVariantLikely, breakdownMismatch, danglingParentLikely } from '@/lib/boq/router/validate'

const covered = ['Marble', 'Granite', 'رخام', 'جرانيت']

test('section headers are dropped, real items are not', () => {
  for (const h of ['DIVISION 09 - FINISHES', 'WALL FINISHES', 'FLOOR  FINISHES', 'Internal Threshold Finishes', 'EXTERNAL CLADDING WORK', 'BILL NO. 2 - Main Works', 'DIVISION 32 – EXTERIOR IMPROVEMENTS']) {
    assert.equal(sectionHeaderLikely(h, 0, covered), true, h)
    assert.equal(validateRow({ description: h, details: '', quantity: 0, unit: '' }, covered).drop, true, h)
  }
  for (const item of ['Supply and install for stair 30mm THK Saudi Bianco Granite', 'NATURAL STONE COBBLE TILES 600x600mm', 'Granite Setts', 'Omani Stone Stair - Tread', 'BLACK GALAXY GRANITE FLOORING']) {
    assert.equal(sectionHeaderLikely(item, 0, covered), false, item)
  }
  // A quantity makes it an item no matter how it is written.
  assert.equal(sectionHeaderLikely('WALL FINISHES', 120, covered), false)
})

test('orphan variants (child rows that lost the parent spec) are flagged, never dropped', () => {
  for (const d of ['90mm wide', 'A: 100mm wide', '120 mm', '(b) 150 mm high', 'Ref. ST-01']) {
    assert.equal(orphanVariantLikely(d, '', covered), true, d)
    const v = validateRow({ description: d, details: null, quantity: 2, unit: 'm' }, covered)
    assert.equal(v.drop, false)
    assert.ok(v.marks.some((m) => m.includes('بند فرعي')), d)
  }
  // The same child WITH the parent's material inherited is fine.
  assert.equal(orphanVariantLikely('90mm wide', 'Granite threshold 20mm polished', covered), false)
  assert.equal(orphanVariantLikely('Granite threshold 90mm wide', '', covered), false)
})

test('dangling parent lines are flagged', () => {
  assert.equal(danglingParentLikely('Supply and installation of', 0), true)
  assert.equal(danglingParentLikely('Supply and install precast', 0), false, 'names a material → not dangling')
  assert.equal(danglingParentLikely('Supply and installation of', 40), false, 'has a quantity')
})

test('breakdown that does not add up is flagged; one that does is silent', () => {
  assert.deepEqual(breakdownMismatch('LIV 900, H1P 150, H2P 140, SOQ1 90', 1280), null)
  assert.deepEqual(breakdownMismatch('LIV 900, H1P 150, H2P 140, SOQ1 90', 7700), { sum: 1280, parts: 4 })
  assert.equal(breakdownMismatch('thickness 20, size 600', 100), null, 'attributes are not zones')
  assert.equal(breakdownMismatch('LIV 900', 900), null, 'a single number is not a breakdown')
  const v = validateRow({ description: 'Beige Terraventino marble tiles', details: 'LIV 900, H1P 150', quantity: 7700, unit: 'm2' }, covered)
  assert.ok(v.marks.some((m) => m.includes('1050')))
})
