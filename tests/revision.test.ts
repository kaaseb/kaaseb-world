// Revision awareness — the latest issue of a sheet wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRevision, compareRevision, docKey, supersededMap } from '@/lib/boq/router/revision'

test('parseRevision: file names, title blocks, Arabic', () => {
  assert.equal(parseRevision('A-301 Rev C.pdf'), 'C')
  assert.equal(parseRevision('A-301_R2.pdf'), '2')
  assert.equal(parseRevision('Finishes Schedule REV.03.pdf'), '03')
  assert.equal(parseRevision('S-12 (Revision B).pdf'), 'B')
  assert.equal(parseRevision('Sold.pdf', 'GROUND FLOOR PLAN', 'REV: D  DATE 2026-01-02'), 'D')
  assert.equal(parseRevision('مخطط اللوبي إصدار 3.pdf'), '3')
  assert.equal(parseRevision('Lobby marble spec.pdf'), null)
  assert.equal(parseRevision('reversible cladding.pdf'), null, '"reversible" is not a revision')
})

test('compareRevision: numbers vs numbers, letters vs letters, never across', () => {
  assert.ok(compareRevision('C', 'A') > 0)
  assert.ok(compareRevision('2', '10') < 0)
  assert.equal(compareRevision('B', '2'), 0)
})

test('docKey groups the same sheet across revisions', () => {
  assert.equal(docKey('A-301 Rev A.pdf', null), docKey('A-301 Rev C.pdf', null))
  assert.equal(docKey('anything.pdf', 'A-301'), docKey('other.pdf', 'a 301'))
  assert.notEqual(docKey('A-301 Rev A.pdf', null), docKey('A-302 Rev A.pdf', null))
})

test('supersededMap marks only older issues', () => {
  const m = supersededMap([
    { sha: 'a', name: 'A-301 Rev A.pdf', docNumber: 'A-301', title: null },
    { sha: 'c', name: 'A-301 Rev C.pdf', docNumber: 'A-301', title: null },
    { sha: 'x', name: 'Spec.pdf', docNumber: null, title: null },
    { sha: 's1', name: 'Schedule_R1.pdf', docNumber: null, title: null },
    { sha: 's3', name: 'Schedule_R3.pdf', docNumber: null, title: null },
  ])
  assert.deepEqual(m.get('a'), { rev: 'A', latest: 'C', latestName: 'A-301 Rev C.pdf' })
  assert.equal(m.has('c'), false)
  assert.equal(m.has('x'), false)
  assert.deepEqual(m.get('s1'), { rev: '1', latest: '3', latestName: 'Schedule_R3.pdf' })
})
