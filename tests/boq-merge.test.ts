// Several BOQ files per project — merged completely, cross-file copies folded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergePhase1Parts, dedupeAcrossFiles, fileStem } from '@/lib/boq/router/merge'

test('mergePhase1Parts: every file read, sections prefixed with the file, departments unioned', () => {
  const m = mergePhase1Parts([
    { fileName: 'BOQ - Stone Seating.xlsx', subject: 'supply natural stone seating', detected_departments: ['Granite'], items: [{ description: 'Stone seating', section: 'Sheet1' }], notes: 'a' },
    { fileName: 'BOQ - Marble Flooring & Cladding.xlsx', subject: '', detected_departments: ['Marble', 'granite'], items: [{ description: 'Marble flooring', section: '' }, { description: 'Marble cladding', section: 'Walls' }], notes: '' },
  ], true)
  assert.equal(m.subject, 'supply natural stone seating')
  assert.deepEqual(m.detected_departments, ['Granite', 'Marble'])
  assert.equal(m.items.length, 3)
  assert.equal(m.items[0].section, 'BOQ - Stone Seating › Sheet1')
  assert.equal(m.items[1].section, 'BOQ - Marble Flooring & Cladding')
  assert.equal(m.items[2]._boqFile, 'BOQ - Marble Flooring & Cladding.xlsx')
  assert.equal(m.notes, 'BOQ - Stone Seating: a')
  // Single file: sections untouched.
  const s = mergePhase1Parts([{ fileName: 'x.xlsx', items: [{ description: 'a', section: 'Div.09' }] }], false)
  assert.equal(s.items[0].section, 'Div.09')
  assert.equal(fileStem('BOQ - ALL PACKAGES COMBINED.xlsx'), 'BOQ - ALL PACKAGES COMBINED')
})

test('dedupeAcrossFiles: identical line in the COMBINED workbook and a package file → kept once, audited', () => {
  const rows: Array<{ description: string; quantity: number; unit: string; boqFile: string; dupOf?: string | null }> = [
    { description: 'External Natural Stone Seating', quantity: 35, unit: 'pcs', boqFile: 'BOQ - ALL PACKAGES COMBINED.xlsx' },
    { description: 'Marble flooring 20mm', quantity: 400, unit: 'm2', boqFile: 'BOQ - ALL PACKAGES COMBINED.xlsx' },
    { description: 'External Natural Stone Seating', quantity: 35, unit: 'pcs', boqFile: 'BOQ - Stone Seating.xlsx' },
    { description: 'Marble flooring 20mm', quantity: 420, unit: 'm2', boqFile: 'BOQ - Marble Flooring.xlsx' }, // different qty → NOT a copy
    { description: 'Granite threshold', quantity: 7, unit: 'm', boqFile: 'BOQ - Stone Seating.xlsx' },
    { description: 'Granite threshold', quantity: 7, unit: 'm', boqFile: 'BOQ - Stone Seating.xlsx' }, // same file → left for the review flag
  ]
  const r = dedupeAcrossFiles(rows)
  assert.equal(r.rows.length, 5)
  assert.equal(r.merged.length, 1)
  assert.equal(r.merged[0].droppedFrom, 'BOQ - Stone Seating.xlsx')
  assert.equal(r.rows[0].dupOf, 'BOQ - Stone Seating.xlsx')
  assert.equal(r.rows.filter((x) => x.description === 'Marble flooring 20mm').length, 2, 'different quantities are two lines')
  assert.equal(r.rows.filter((x) => x.description === 'Granite threshold').length, 2, 'same-file repeat untouched')
})
