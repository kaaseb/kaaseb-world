// Row coverage — counting the file's own rows and matching them to items.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidateRows, unmatchedRows, rowMatchScore, splitCsvLine } from '@/lib/boq/router/coverage'

const vanity = `RECORD,INTERNAL LINK,REFERENCE#,TASK CODE,PAGE,ITEM,DESCRIPTION,UNIT,QUANTITY,RATE,AMOUNT
6,28735,,,1,,064023 INTERIOR ARCHITECTURAL WOOD WORK
8,28737,,,1,,Vanity counter unit with bottom self-
9,28738,01.wood.1,,1,A,Vanity counter unit with bottom self; type ST-02+WD-01; dimesion 1425 x 600 x 525mm; to fit to 1 basin; as Drg. AID-00-8022; detail 1,Nr,1
10,28739,01.wood.3,,1,B,Vanity counter unit with bottom self; type ST-02+WD-01; dimesion 1775 x 600 x 525mm; to fit to 1 basin; as Drg. AID-00-8022; detail 1,Nr,1
11,28740,01.wood.5,,1,C,Vanity counter unit with bottom self; type ST-07+WD-02; dimesion 2500 x 600 x 550mm; to fit to 1 basin; as Drg. AID-00-8029; detail 2,Nr,2`

const paving = `Item,Description,Qty,Unit,Price
,PAVING AND SURFACING
,Paving type 1
,"Chedworth Limestone, sawn finish, beige-light grey colour, laid in stretcher bond pattern "
A,Size 400 x random length x 50mm thick,806,m2,240
,Paving type 6
,"Tobermore Braemar (or similar approved), ground finish, jura grey colour, laid in herringbone "
B,Size 100 x 200 x 80mm thick,582,m2
D,Size 600 x 900 x 30mm thick,"3,539",m2
,Paving type 9a
A,Size 600 x 600 x 40mm thick`

test('splitCsvLine handles quoted cells with commas', () => {
  assert.deepEqual(splitCsvLine('D,Size 600 x 900 x 30mm thick,"3,539",m2'), ['D', 'Size 600 x 900 x 30mm thick', '3,539', 'm2'])
})

test('candidateRows: a unit next to a quantity with a description; headers and parents are not rows', () => {
  const v = candidateRows(vanity)
  assert.equal(v.length, 3, JSON.stringify(v.map((c) => c.text.slice(0, 30))))
  // No header naming the qty column → the number BEFORE the unit is the quantity.
  assert.deepEqual(candidateRows('A,Marble skirting 100mm,120,lm,45').map((c) => [c.qty, c.unit]), [[120, 'lm']])
  assert.equal(v[0].qty, 1); assert.equal(v[0].unit, 'Nr'); assert.ok(v[0].text.startsWith('Vanity counter unit with bottom self; type ST-02'))
  const p = candidateRows(paving)
  assert.deepEqual(p.map((c) => [c.qty, c.unit]), [[806, 'm2'], [582, 'm2'], [3539, 'm2']])
})

test('unmatchedRows: an extracted item accounts for its row; a missing row is reported', () => {
  const cands = candidateRows(vanity)
  const items = [
    { description: 'Vanity top ST-02', details: 'كود: ST-02 – 1425 x 600 mm (top) – 1 basin – Drg. AID-00-8022 – الخزانة الخشبية WD-01 خارج نطاقنا', quantity: 1, unit: 'pcs' },
    { description: 'Vanity top ST-07', details: 'كود: ST-07 – 2500 x 600 mm (top) – 1 basin – Drg. AID-00-8029', quantity: 2, unit: 'pcs' },
  ]
  assert.ok(rowMatchScore(cands[0], items[0]) >= 0.45, `score ${rowMatchScore(cands[0], items[0])}`)
  const missing = unmatchedRows(cands, items)
  assert.equal(missing.length, 1)
  assert.ok(missing[0].text.includes('1775 x 600'), 'the 1775 row was never extracted')
})

test('unmatchedRows: the three Tobermore rows show up when the model drops them', () => {
  const cands = candidateRows(paving)
  const items = [{ description: 'Chedworth Limestone paving type 1', details: '50mm – sawn – beige-light grey – 400 x random length', quantity: 806, unit: 'm2' }]
  const missing = unmatchedRows(cands, items)
  assert.deepEqual(missing.map((m) => m.qty), [582, 3539])
})
