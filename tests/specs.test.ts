// Spec knowledge base — the deterministic halves: which pages get harvested,
// and how a row is matched to the harvested definitions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { specScore, pickSpecPages, matchSpec, codesIn, materialOf, type SpecEntry } from '@/lib/boq/router/specs'
import { EMPTY_ATTRS, type IndexedFile } from '@/lib/boq/router/core'

const file = (name: string, bucket: IndexedFile['bucket'], pages: Array<{ text: string | null; anchor?: string }>): IndexedFile => ({
  sha: name, name, bucket, source: { url: 'u', name, bucket }, kind: pages.some((p) => p.text) ? 'text' : 'visual',
  pageCount: pages.length, pages: pages.map((p, i) => ({ page: i + 1, text: p.text, anchor: p.anchor || (p.text ? p.text.slice(0, 40) : '(صفحة ممسوحة — تُقرأ بصرياً)') })),
  docNumber: null, title: null, partialToc: false, bytes: 1, error: null,
})

test('specScore: stone + spec vocabulary scores, chatter does not', () => {
  assert.ok(specScore('MARBLE FLOORING: 20 mm thick, polished finish, Crema Marfil colour, 600x600 mm tiles, sealed.') > 0)
  assert.equal(specScore('The contractor shall submit the programme within 14 days of the letter of award.'), 0)
  assert.equal(specScore('Thickness 20 mm, finish polished, size 600x600, colour beige'), 0, 'no stone word → not a stone spec')
})

test('pickSpecPages: spec pages first, legends as visual, bounded', () => {
  const spec = file('Spec.pdf', 'spec', [
    { text: 'Section 09 30 00 STONE. Marble: 20 mm thick, polished finish, colour Crema Marfil, size 600x600 mm, sealed, cut to size.' },
    { text: 'Programme and submittals — the contractor shall submit within 14 days.' },
  ])
  const dwg = file('A-501.pdf', 'drawing', [{ text: null, anchor: 'Finishes legend and material key' }, { text: null, anchor: 'Ground floor plan' }])
  const picks = pickSpecPages([spec, dwg])
  assert.deepEqual(picks.map((p) => `${p.file.name}:${p.page}:${p.visual}`), ['Spec.pdf:1:false', 'A-501.pdf:1:true'])
})

test('codesIn / materialOf', () => {
  assert.deepEqual([...codesIn('Marble flooring ST-01 as per schedule, 20mm, 600x600')], ['st01'])
  assert.deepEqual([...codesIn('Granite paver type PV 02A')], ['pv02a'])
  assert.equal(materialOf('بلاط رخام للوبي'), 'marble')
  assert.equal(materialOf('Granite treads'), 'granite')
  assert.equal(materialOf('Porcelain tile'), null)
})

const entries: SpecEntry[] = [
  { code: 'ST-01', name: 'Carrara White', attrs: { ...EMPTY_ATTRS, material: 'marble', finish: 'honed', thickness_mm: 20, colour: 'white' }, appliesTo: 'Lobby floor', scope: 'specific', quote: 'q', fileName: 'Finishes.pdf', page: 3, bucket: 'spec', visual: false },
  { code: null, name: null, attrs: { ...EMPTY_ATTRS, material: 'marble', thickness_mm: 30, finish: 'polished', treatment: 'sealer', cut: 'cut to size' }, appliesTo: null, scope: 'general', quote: 'q', fileName: 'Spec.pdf', page: 12, bucket: 'spec', visual: false },
  { code: null, name: 'Black Galaxy', attrs: { ...EMPTY_ATTRS, material: 'granite', finish: 'flamed', thickness_mm: 40 }, appliesTo: 'external paving, main gate', scope: 'specific', quote: 'q', fileName: 'Spec.pdf', page: 14, bucket: 'spec', visual: false },
]

test('matchSpec: code beats everything, then the general clause fills the rest', () => {
  const m = matchSpec({ description: 'ST-01', details: 'كود: ST-01', section: 'Floor finishes', department_match: 'Marble' }, entries)
  assert.ok(m && !m.generic)
  assert.equal(m!.attrs.thickness_mm, 20, 'code entry wins the thickness')
  assert.equal(m!.attrs.finish, 'honed')
  assert.equal(m!.attrs.treatment, null, 'a general clause never rides along with a specific hit')
  assert.deepEqual(m!.cites, ['Finishes.pdf ص3'])
})

test('matchSpec: applies-to words in the row/section match the schedule line', () => {
  const m = matchSpec({ description: 'Granite paving', details: null, section: 'External paving – Main Gate', department_match: 'Granite' }, entries)
  assert.ok(m && !m.generic)
  assert.equal(m!.attrs.finish, 'flamed')
  assert.equal(m!.attrs.thickness_mm, 40)
})

test('matchSpec: only a general clause → marked generic; wrong material never matches', () => {
  const g = matchSpec({ description: 'Marble skirting', details: null, section: null, department_match: 'Marble' }, entries)
  assert.ok(g && g.generic)
  assert.equal(g!.attrs.thickness_mm, 30)
  assert.equal(g!.attrs.cut, 'cut to size')
  assert.equal(matchSpec({ description: 'Porcelain tile', details: null, section: null, department_match: null }, entries), null, 'no material, no code, no name → nothing')
  const gr = matchSpec({ description: 'Granite threshold', details: null, section: null, department_match: 'Granite' }, entries)
  assert.ok(!gr || gr.attrs.thickness_mm !== 30, 'marble general clause must not fill a granite row')
})

test('statedFields: what the row already says is never contradicted by a file', async () => {
  const { statedFields } = await import('@/lib/boq/router/specs')
  const s = statedFields('Marble flooring 20mm – polished – 600x600 – Crema Marfil – sealed – bullnose edge')
  assert.deepEqual([...s].sort(), ['colour', 'cut', 'finish', 'material', 'size', 'treatment'].sort())
  assert.deepEqual([...statedFields('Threshold as per drawings')], [])
  assert.deepEqual([...statedFields('رخام مصقول أبيض')].sort(), ['colour', 'finish', 'material'])
})
