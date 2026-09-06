// ONE totals function for every quotation surface — Furn, Tannoor and manual.
//
// Before this, each surface summed lines, added shipping and applied VAT in its
// own copy of the arithmetic (client table, server route, print page…) and they
// drifted: a cent here, a shipping line missing there. Every surface now calls
// this, so the on-screen total, the stored quotation row and the printed PDF
// are the same number by construction.
//
// Deliberately dependency-free (no fx.ts import): it runs in client components,
// server routes and the test harness alike.

export const VAT_RATE = 0.15

export interface TotalsLine {
  quantity: number | string | null | undefined
  unit_price: number | string | null | undefined
}

export interface Totals {
  itemsSum: number
  shipping: number
  subtotal: number
  vat: number
  total: number
}

/** Round money to 2 dp at one chokepoint so line sums reconcile with the stored
 *  NUMERIC(16,2) totals instead of drifting by a cent. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/**
 * items + (optional) delivery/shipping line → subtotal → VAT → total.
 * Shipping is folded INTO the subtotal so VAT applies to it (the business rule
 * on every surface). Negative/NaN inputs count as 0 — never throw on a blank.
 */
export function computeTotals(lines: TotalsLine[], shipping = 0, vatRate = VAT_RATE): Totals {
  const itemsSum = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0))
  const ship = round2(Math.max(0, Number(shipping) || 0))
  const subtotal = round2(itemsSum + ship)
  const vat = round2(subtotal * vatRate)
  const total = round2(subtotal + vat)
  return { itemsSum, shipping: ship, subtotal, vat, total }
}
