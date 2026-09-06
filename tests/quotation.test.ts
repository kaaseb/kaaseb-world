// The unified quotation core: one totals function, one catalogue matcher.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTotals, round2 } from '@/lib/quotation/totals'
import { matchVariant, canonFinish, type CatalogVariant } from '@/lib/quotation/match'

test('computeTotals: shipping is inside the subtotal, VAT applies to it, cents reconcile', () => {
  const t = computeTotals([{ quantity: 10, unit_price: 100 }, { quantity: 3, unit_price: 33.333 }], 50)
  assert.equal(t.itemsSum, 1100)
  assert.equal(t.shipping, 50)
  assert.equal(t.subtotal, 1150)
  assert.equal(t.vat, 172.5)
  assert.equal(t.total, 1322.5)
  const blank = computeTotals([{ quantity: null, unit_price: undefined }], -5)
  assert.deepEqual(blank, { itemsSum: 0, shipping: 0, subtotal: 0, vat: 0, total: 0 })
  assert.equal(round2(0.1 + 0.2), 0.3)
})

const catalog: CatalogVariant[] = [
  { id: 'bg20p', name: 'Black Galaxy Granite جرانيت بلاك جالكسي', colours: ['أسود', 'Black'], finish: 'polished', thickness_mm: 20, unit: 'm2', price_sar: 180, price_usd: 48, department: 'Granite' },
  { id: 'bg30p', name: 'Black Galaxy Granite', colours: ['أسود'], finish: 'polished', thickness_mm: 30, unit: 'm2', price_sar: 240, price_usd: 64, department: 'Granite' },
  { id: 'bg20h', name: 'Black Galaxy Granite', colours: ['أسود'], finish: 'honed', thickness_mm: 20, unit: 'm2', price_sar: 175, price_usd: 46, department: 'Granite' },
  { id: 'car20p', name: 'Carrara White Marble رخام كرارا', colours: ['أبيض', 'White'], finish: 'polished', thickness_mm: 20, unit: 'm2', price_sar: 320, price_usd: 85, department: 'Marble' },
]

test('matchVariant: thickness + finish pick the right SKU, never name alone', () => {
  const m = matchVariant('Black Galaxy granite flooring', { thickness_mm: 30, finish: 'polished' }, catalog)
  assert.equal(m?.product_id, 'bg30p')
  const h = matchVariant('Black Galaxy granite, honed', { thickness_mm: 20 }, catalog)
  assert.equal(h?.product_id, 'bg20h')
  const mismatch = matchVariant('Black Galaxy granite, honed', { thickness_mm: 50 }, catalog)
  assert.equal(mismatch, null, 'a known thickness that matches nothing must not be forced')
})

test('matchVariant: material sanity and unrelated lines', () => {
  assert.equal(matchVariant('Carrara White marble 20mm polished', {}, catalog)?.product_id, 'car20p')
  assert.equal(matchVariant('Precast concrete kerb 300x150', {}, catalog), null)
  assert.equal(matchVariant('Black marble slab', { material: 'marble' }, catalog), null, 'marble line must not get a granite SKU')
})

test('canonFinish: bilingual synonyms', () => {
  assert.equal(canonFinish('مصقول'), 'polished')
  assert.equal(canonFinish('Bush-Hammered'), 'bush-hammered')
  assert.equal(canonFinish('shot blasted'), 'shot-blasted')
  assert.equal(canonFinish(''), null)
})
