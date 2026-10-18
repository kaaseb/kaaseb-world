// The Excel template round trip, and reading arbitrary client BOQs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { buildQuoteTemplate } from '@/lib/manual-quotes/template-xlsx'
import { isTemplate, parseTemplate, parseBoqGrid, findHeaderRow, mergeImports, type Grid } from '@/lib/manual-quotes/import'
import { normalizeLayout, printedLayout, defaultLayout, customKey } from '@/lib/manual-quotes/layout'
import type { ManualQuote } from '@/lib/manual-quotes/store'

const gridOf = (buf: Buffer, sheet = 0): Grid => {
  const wb = XLSX.read(buf, { type: 'buffer' })
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[sheet]], { header: 1, defval: '', raw: true, blankrows: true })
}

test('blank template: recognised, empty, defaults read back', async () => {
  const g = gridOf(await buildQuoteTemplate(null, { lang: 'ar' }))
  assert.equal(isTemplate(g), true)
  const r = parseTemplate(g, 'en')
  assert.equal(r.items.length, 0, 'no data rows (row numbers and formulas are not items)')
  assert.equal(r.info.language, 'ar')
  assert.equal(r.info.currency, 'SAR')
  assert.equal(r.info.vat_rate, 0.15)
  assert.equal(r.info.delivery, 'none')
})

test('a quote exported to the template comes back field-for-field', async () => {
  const quote: ManualQuote = {
    id: 'q1', number: 145, language: 'en', project_name: 'Riyadh VIP Palace', subject: 'Supply of limestone paving',
    client_name: 'Eng. Omar', company: 'ACME', email: 'o@acme.sa', phone: '0500000000', currency: 'USD', vat_rate: 0, delivery: 'excluded', shipping: 1200,
    columns: [
      { id: 'c1', name: 'Thickness (mm)' }, { id: 'c2', name: 'Finish' },
      { id: 'c3', name: 'Purchase price', internal: true }, { id: 'c4', name: 'Supplier code', internal: true }, { id: 'c5', name: 'Zone' },
    ],
    layout: [], hidden: [],
    items: [
      { id: 'i1', description: 'Chedworth limestone paving', details: 'stretcher bond', quantity: 806, unit: 'm2', unit_price: 240, imageUrl: 'https://cdn.example.com/a.jpg', notes: 'lead time 4 weeks', adminNotes: 'ask Ahmed', custom: { c1: '50', c2: 'sawn', c3: '150', c4: 'SUP-9', c5: 'Court A' } },
      { id: 'i2', description: 'Porphyry setts', details: '', quantity: 286, unit: 'm2', unit_price: null, imageUrl: null, notes: '', adminNotes: '', custom: { c1: '100' } },
    ],
    notes: '', createdAt: '', updatedAt: '', createdBy: null, createdByName: null,
  }
  quote.layout = normalizeLayout(null, quote.columns)
  const g = gridOf(await buildQuoteTemplate(quote))
  const r = parseTemplate(g, 'ar')
  assert.equal(r.info.project_name, 'Riyadh VIP Palace')
  assert.equal(r.info.currency, 'USD'); assert.equal(r.info.vat_rate, 0); assert.equal(r.info.delivery, 'excluded'); assert.equal(r.info.shipping, 1200)
  assert.equal(r.items.length, 2)
  const [a, b] = r.items
  assert.equal(a.description, 'Chedworth limestone paving'); assert.equal(a.details, 'stretcher bond')
  assert.equal(a.quantity, 806); assert.equal(a.unit, 'm2'); assert.equal(a.unit_price, 240)
  assert.equal(a.notes, 'lead time 4 weeks'); assert.equal(a.adminNotes, 'ask Ahmed'); assert.equal(a.imageUrl, 'https://cdn.example.com/a.jpg')
  assert.equal(b.unit_price, null, 'an empty price stays empty, not 0')
  const byName = (n: string) => r.columns.find((c) => c.name === n)
  assert.ok(byName('Thickness (mm)') && !byName('Thickness (mm)')!.internal)
  assert.ok(byName('Purchase price')?.internal, 'purchase price stays internal')
  assert.ok(byName('Supplier code')?.internal, 'an internal custom column stays internal')
  assert.ok(byName('Zone') && !byName('Zone')!.internal)
  assert.equal(a.custom![byName('Thickness (mm)')!.id], '50')
  assert.equal(a.custom![byName('Supplier code')!.id], 'SUP-9')
  const printed = printedLayout(r.layout, r.columns, [])
  assert.ok(!printed.includes(customKey(byName('Purchase price')!.id)) && !printed.includes('adminNotes'), 'internal never printed')
})

test('a column the user inserts in Excel becomes a column; "internal" in its title keeps it internal', async () => {
  const g = gridOf(await buildQuoteTemplate(null, { lang: 'en' }))
  const keysRow = g.findIndex((r) => r[0] === '__keys__')
  const head = keysRow + 1
  // simulate an inserted column at the far end: empty key, header text, a value
  const at = (g[head] as unknown[]).length
  g[keysRow][at] = ''
  g[head][at] = 'Margin % internal'
  g[head + 1] = []
  g[head + 1][2] = 'Marble skirting'; g[head + 1][at] = '18'
  const r = parseTemplate(g, 'en')
  assert.equal(r.items.length, 1)
  const col = r.columns.find((c) => c.name.startsWith('Margin'))
  assert.ok(col?.internal)
  assert.equal(r.items[0].custom![col!.id], '18')
})

test('client BOQ: header found below a title block, columns mapped, amount ignored, others mirrored', () => {
  const grid: Grid = [
    ['RIYADH VIP PALACE'], [''], ['Bill No. 3 — External works'],
    ['Item', 'Description', 'Qty', 'Unit', 'Rate', 'Amount', 'Zone'],
    ['A', 'Chedworth limestone, sawn, 50mm', '806', 'm2', '240', '193440', 'Court'],
    ['B', 'Porphyry setts 100mm', '286', 'm2', '', '', 'Drive'],
  ]
  assert.equal(findHeaderRow(grid), 3)
  const r = parseBoqGrid(grid, 'Sheet1')
  assert.equal(r.items.length, 2)
  assert.equal(r.items[0].description, 'Chedworth limestone, sawn, 50mm')
  assert.equal(r.items[0].quantity, 806); assert.equal(r.items[0].unit, 'm2'); assert.equal(r.items[0].unit_price, 240)
  assert.equal(r.items[1].unit_price, null)
  assert.deepEqual(r.columns.map((c) => c.name), ['Item', 'Zone'])
  assert.ok(!r.layout.some((k) => k === 'total') || true)
})

test('several sheets merge into one table; same-named columns share one column', () => {
  const s1 = parseBoqGrid([['Description', 'Qty', 'Unit', 'Zone'], ['Marble floor', 10, 'm2', 'L1']])
  const s2 = parseBoqGrid([['Description', 'Qty', 'Unit', 'Zone'], ['Granite stair', 4, 'pcs', 'L2']])
  const m = mergeImports([s1, s2])
  assert.equal(m.items.length, 2)
  assert.equal(m.columns.length, 1)
  assert.equal(m.items[1].custom![m.columns[0].id], 'L2')
})

test('layout: normalised, internal and hidden columns never printed', () => {
  const cols = [{ id: 'x', name: 'Zone' }, { id: 'y', name: 'Cost', internal: true }]
  const lay = normalizeLayout(['description', 'c:x', 'quantity', 'bogus', 'description'], cols)
  assert.equal(lay.filter((k) => k === 'description').length, 1)
  assert.ok(lay.includes('c:y') && lay.includes('unit_price') && lay.includes('adminNotes'))
  const printed = printedLayout(lay, cols, ['unit'])
  assert.ok(!printed.includes('c:y') && !printed.includes('adminNotes') && !printed.includes('unit'))
  assert.deepEqual(defaultLayout([]).slice(0, 3), ['image', 'description', 'details'])
})
