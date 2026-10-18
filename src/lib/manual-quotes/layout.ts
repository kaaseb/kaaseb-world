// The manual-quote TABLE LAYOUT — shared by the editor grid, the print page,
// the Excel template and the importers, so the four never disagree.
//
// A quote's table is an ordered list of column keys:
//   • standard keys  — image, description, details, quantity, unit, unit_price,
//                      total, notes, adminNotes
//   • custom keys    — "c:<columnId>" for columns the team adds
// Every column can be shown on the quotation or kept for management only:
//   • a standard column is hidden from the PDF when listed in `hidden`
//   • a custom column is internal when `internal: true`
//   • adminNotes is ALWAYS internal — it never reaches the client.
//
// Pure; covered by tests/manual-layout.test.ts.

export const STD_KEYS = ['image', 'description', 'details', 'quantity', 'unit', 'unit_price', 'total', 'notes', 'adminNotes'] as const
export type StdKey = typeof STD_KEYS[number]
export type LayoutKey = StdKey | `c:${string}`

export interface LayoutColumn { id: string; name: string; internal?: boolean }

export const STD_LABEL: Record<StdKey, { ar: string; en: string }> = {
  image: { ar: 'صورة', en: 'Image' },
  description: { ar: 'الوصف', en: 'Description' },
  details: { ar: 'التفاصيل', en: 'Details' },
  quantity: { ar: 'الكمية', en: 'Qty' },
  unit: { ar: 'الوحدة', en: 'Unit' },
  unit_price: { ar: 'سعر الوحدة', en: 'Unit price' },
  total: { ar: 'الإجمالي', en: 'Total' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
  adminNotes: { ar: 'ملاحظات الإدارة', en: 'Admin notes' },
}

const isStd = (k: string): k is StdKey => (STD_KEYS as readonly string[]).includes(k)
export const customKey = (id: string): LayoutKey => `c:${id}`
export const customIdOf = (k: string): string | null => (k.startsWith('c:') ? k.slice(2) : null)

/** The default order: image, description, details, the custom columns, then the numbers, then notes. */
export function defaultLayout(columns: LayoutColumn[]): LayoutKey[] {
  return ['image', 'description', 'details', ...columns.map((c) => customKey(c.id)), 'quantity', 'unit', 'unit_price', 'total', 'notes', 'adminNotes']
}

/**
 * A valid layout for these columns: known keys in the given order, duplicates
 * dropped, missing standard keys restored in their default slot, and any custom
 * column missing from the order placed just before "quantity".
 */
export function normalizeLayout(layout: unknown, columns: LayoutColumn[]): LayoutKey[] {
  const ids = new Set(columns.map((c) => c.id))
  const seen = new Set<string>()
  const out: LayoutKey[] = []
  for (const raw of Array.isArray(layout) ? layout : []) {
    const k = String(raw || '')
    if (seen.has(k)) continue
    const cid = customIdOf(k)
    if (isStd(k) || (cid && ids.has(cid))) { out.push(k as LayoutKey); seen.add(k) }
  }
  // Missing custom columns go before quantity (or at the end).
  for (const c of columns) {
    const k = customKey(c.id)
    if (seen.has(k)) continue
    const qi = out.indexOf('quantity')
    if (qi >= 0) out.splice(qi, 0, k); else out.push(k)
    seen.add(k)
  }
  // Missing standard keys in their default relative position.
  const def = defaultLayout([])
  for (const k of def) {
    if (seen.has(k)) continue
    const di = def.indexOf(k)
    const after = def.slice(0, di).reverse().find((x) => seen.has(x))
    const at = after ? out.indexOf(after) + 1 : 0
    out.splice(at, 0, k)
    seen.add(k)
  }
  return out
}

/** Columns that reach the client's PDF, in order. */
export function printedLayout(layout: LayoutKey[], columns: LayoutColumn[], hidden: string[]): LayoutKey[] {
  const hid = new Set(hidden)
  const internal = new Set(columns.filter((c) => c.internal).map((c) => customKey(c.id)))
  return layout.filter((k) => k !== 'adminNotes' && !hid.has(k) && !internal.has(k))
}

export function isInternal(k: LayoutKey, columns: LayoutColumn[], hidden: string[]): boolean {
  if (k === 'adminNotes') return true
  const cid = customIdOf(k)
  if (cid) return !!columns.find((c) => c.id === cid)?.internal
  return hidden.includes(k)
}
