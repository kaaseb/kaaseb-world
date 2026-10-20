// Quote history: the human diff that the team reads ("who changed what").

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffQuotes } from '@/lib/manual-quotes/history'
import { previewPatch, type ManualQuote } from '@/lib/manual-quotes/store'

const base = (): ManualQuote => ({
  id: 'q1', number: 168, language: 'ar', project_name: 'فيلا', subject: 'رخام', client_name: 'خالد', company: 'الراجحي',
  email: '', phone: '', currency: 'SAR', vat_rate: 0.15, delivery: 'none', shipping: 0,
  columns: [{ id: 'c1', name: 'سعر الشراء', internal: true }], layout: [], hidden: [],
  items: [
    { id: 'i1', description: 'رخام كرارا', details: '20mm', quantity: 100, unit: 'm²', unit_price: 450, imageUrl: null, notes: '', adminNotes: '', custom: { c1: '300' } },
    { id: 'i2', description: 'جرانيت أسود', details: '', quantity: 50, unit: 'm²', unit_price: 300, imageUrl: null, notes: '', adminNotes: '' },
  ],
  notes: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', createdBy: null, createdByName: null,
})

test('a price change names the line, the field, before and after', () => {
  const a = base(); const b = base(); b.items[0].unit_price = 480
  assert.deepEqual(diffQuotes(a, b), [{ label: 'سعر الوحدة', item: '1. رخام كرارا', before: '450', after: '480' }])
})

test('quote fields, VAT and delivery read in words', () => {
  const a = base(); const b = base(); b.vat_rate = 0; b.delivery = 'included'; b.company = 'نسما'
  const d = diffQuotes(a, b)
  assert.ok(d.some((c) => c.label === 'الضريبة' && c.before === '15%' && c.after === 'بدون'))
  assert.ok(d.some((c) => c.label === 'التوصيل' && c.after === 'شامل'))
  assert.ok(d.some((c) => c.label === 'الشركة' && c.after === 'نسما'))
})

test('management-only columns are labelled as such', () => {
  const a = base(); const b = base(); b.items[0].custom = { c1: '320' }
  assert.deepEqual(diffQuotes(a, b), [{ label: 'سعر الشراء (للإدارة)', item: '1. رخام كرارا', before: '300', after: '320' }])
})

test('added and removed lines; no false "reorder"', () => {
  const a = base(); const b = base()
  b.items = [b.items[0], { id: 'i3', description: 'عتبات', details: '', quantity: 10, unit: 'm', unit_price: 90, imageUrl: null, notes: '', adminNotes: '' }]
  const d = diffQuotes(a, b)
  assert.ok(d.some((c) => c.label === 'بند جديد' && c.item === '2. عتبات'))
  assert.ok(d.some((c) => c.label === 'حذف بند' && c.before === 'جرانيت أسود'))
  assert.ok(!d.some((c) => c.label === 'ترتيب البنود'))
})

test('pure reorder is reported once; identical versions report nothing', () => {
  const a = base(); const b = base(); b.items = [b.items[1], b.items[0]]
  assert.deepEqual(diffQuotes(a, b).map((c) => c.label), ['ترتيب البنود'])
  assert.deepEqual(diffQuotes(base(), base()), [])
})

test('preview = exactly what saving would produce (nothing saved)', () => {
  const q = base()
  const p = previewPatch(q, { items: q.items.map((i) => (i.id === 'i2' ? { ...i, quantity: 60 } : i)) })
  assert.equal(p.items[1].quantity, 60)
  assert.equal(q.items[1].quantity, 50) // original untouched
  assert.deepEqual(diffQuotes(q, p).map((c) => c.label), ['الكمية'])
})
