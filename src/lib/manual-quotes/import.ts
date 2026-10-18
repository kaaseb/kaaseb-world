// Turn an uploaded spreadsheet into manual-quote content — two paths:
//
//   1. OUR TEMPLATE (marker in A1) → every field lands exactly where it belongs:
//      client info, VAT, delivery, the items, each detail in its own column,
//      the management-only columns kept internal.
//   2. ANY OTHER BOQ → the header row is FOUND (not assumed to be row 1 — most
//      BOQs carry titles above the table), the familiar columns are mapped onto
//      description / quantity / unit / price / details, and every other column
//      is mirrored as-is. Every sheet the user picks is read, not just the first.
//
// Pure (takes the grid SheetJS produces); covered by tests/manual-import.test.ts.

import { TEMPLATE_MARKER, KEYS_ROW_MARK, INFO_FIELDS, ITEM_FIELDS, type InfoKey, type ItemKey } from './template-spec'
import type { ManualQuote, ManualQuoteColumn, ManualQuoteItem, QuoteDelivery } from './store'
import { normalizeLayout, customKey, type LayoutKey } from './layout'

export type Grid = unknown[][]

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const rid = () => `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = str(v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
  if (!t || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export interface ImportResult {
  kind: 'template' | 'boq'
  info: Partial<Pick<ManualQuote, 'project_name' | 'company' | 'client_name' | 'email' | 'phone' | 'subject' | 'language' | 'currency' | 'vat_rate' | 'delivery' | 'shipping'>>
  columns: ManualQuoteColumn[]
  items: ManualQuoteItem[]
  layout: LayoutKey[]
  /** Human notes for the toast ("read 3 sheets, header on row 7"). */
  notes: string[]
}

export const isTemplate = (grid: Grid) => str(grid?.[0]?.[0]) === TEMPLATE_MARKER

// ─── 1. our template ───────────────────────────────────────────────────────

function parseLanguage(v: string): 'ar' | 'en' | undefined {
  const t = v.toLowerCase()
  if (!t) return undefined
  if (/^(ar|arabic|عربي|العربية)/.test(t)) return 'ar'
  if (/^(en|english|انجليزي|إنجليزي|الانجليزية)/.test(t)) return 'en'
  return undefined
}
function parseDelivery(v: string): QuoteDelivery | undefined {
  const t = v.toLowerCase()
  if (!t) return undefined
  if (/غير\s*شامل|not\s*incl|excluded|exclude/.test(t)) return 'excluded'
  if (/شامل|incl/.test(t)) return 'included'
  if (/بدون|none|no\b|لا/.test(t)) return 'none'
  return undefined
}

export function parseTemplate(grid: Grid, fallbackLang: 'ar' | 'en'): ImportResult {
  const info: ImportResult['info'] = {}
  const known = new Set(INFO_FIELDS.map((f) => f.key))
  let keysRow = -1
  for (let r = 1; r < grid.length; r++) {
    const k = str(grid[r]?.[0])
    if (k === KEYS_ROW_MARK) { keysRow = r; break }
    if (!known.has(k as InfoKey)) continue
    const v = grid[r]?.[2]
    const s = str(v)
    switch (k as InfoKey) {
      case 'project_name': info.project_name = s; break
      case 'company': info.company = s; break
      case 'client_name': info.client_name = s; break
      case 'email': info.email = s; break
      case 'phone': info.phone = s; break
      case 'subject': info.subject = s; break
      case 'language': { const l = parseLanguage(s); if (l) info.language = l; break }
      case 'currency': { const c = s.toUpperCase(); if (c === 'SAR' || c === 'USD') info.currency = c; break }
      case 'vat': {
        const n = num(v)
        // "15" or "15%" or 0.15 — all mean fifteen percent.
        if (n !== null && n >= 0) info.vat_rate = n > 1 ? Math.min(n, 100) / 100 : n
        break
      }
      case 'delivery': { const d = parseDelivery(s); if (d) info.delivery = d; break }
      case 'shipping': { const n = num(v); if (n !== null && n >= 0) info.shipping = n; break }
    }
  }
  if (keysRow < 0) throw new Error('ملف القالب ناقص (صف المفاتيح مفقود) — حمّل القالب من جديد')
  const lang = info.language || fallbackLang

  const keys = (grid[keysRow] || []).map(str)
  const headers = (grid[keysRow + 1] || []).map(str)
  const fieldByKey = new Map(ITEM_FIELDS.map((f) => [f.key, f]))
  const width = Math.max(keys.length, headers.length)

  // Decide what each spreadsheet column becomes.
  type Slot =
    | { kind: 'std'; key: ItemKey }
    | { kind: 'custom'; name: string; internal: boolean }
  const slots: Array<Slot | null> = []
  for (let c = 1; c < width; c++) {
    const k = keys[c] || ''
    const h = headers[c] || ''
    if (fieldByKey.has(k as ItemKey)) slots[c] = { kind: 'std', key: k as ItemKey }
    else if (k.startsWith('col:')) slots[c] = { kind: 'custom', name: k.slice(4) || h, internal: false }
    else if (k.startsWith('admin:')) slots[c] = { kind: 'custom', name: k.slice(6) || h, internal: true }
    else if (h) slots[c] = { kind: 'custom', name: h.split('\n')[0], internal: /داخلي|internal|إدارة|admin/i.test(h) }
    else slots[c] = null
  }

  // Collect rows first: a detail column is only created when something uses it.
  const dataRows: unknown[][] = []
  for (let r = keysRow + 2; r < grid.length; r++) {
    const row = grid[r] || []
    const any = slots.some((s, c) => s && !(s.kind === 'std' && (s.key === 'no' || s.key === 'total')) && str(row[c]) !== '')
    if (any) dataRows.push(row)
  }

  const columns: ManualQuoteColumn[] = []
  const colIdBySlot = new Map<number, string>()
  const order: LayoutKey[] = []
  slots.forEach((s, c) => {
    if (!s) return
    if (s.kind === 'std') {
      const f = fieldByKey.get(s.key)!
      if (f.column) {
        if (!dataRows.some((row) => str(row[c]) !== '')) return
        const id = rid()
        columns.push({ id, name: f.column[lang], ...(f.internal ? { internal: true } : {}) })
        colIdBySlot.set(c, id)
        order.push(customKey(id))
        return
      }
      const map: Partial<Record<ItemKey, LayoutKey>> = { description: 'description', details: 'details', quantity: 'quantity', unit: 'unit', unit_price: 'unit_price', total: 'total', notes: 'notes', adminNotes: 'adminNotes', image: 'image' }
      const lk = map[s.key]
      if (lk && !order.includes(lk)) order.push(lk)
      return
    }
    const id = rid()
    columns.push({ id, name: s.name.slice(0, 60), ...(s.internal ? { internal: true } : {}) })
    colIdBySlot.set(c, id)
    order.push(customKey(id))
  })

  const items: ManualQuoteItem[] = dataRows.map((row) => {
    const it: ManualQuoteItem = { id: rid(), description: '', details: '', quantity: 0, unit: '', unit_price: null, imageUrl: null, notes: '', adminNotes: '', custom: {} }
    slots.forEach((s, c) => {
      if (!s) return
      const v = row[c]
      const cid = colIdBySlot.get(c)
      if (cid) { const t = str(v); if (t) it.custom![cid] = t; return }
      if (s.kind !== 'std') return
      switch (s.key) {
        case 'description': it.description = str(v); break
        case 'details': it.details = str(v); break
        case 'quantity': it.quantity = Math.max(0, num(v) ?? 0); break
        case 'unit': it.unit = str(v); break
        case 'unit_price': { const n = num(v); it.unit_price = n === null ? null : Math.max(0, n); break }
        case 'notes': it.notes = str(v); break
        case 'adminNotes': it.adminNotes = str(v); break
        case 'image': { const u = str(v); it.imageUrl = /^https:\/\//i.test(u) ? u : null; break }
      }
    })
    return it
  })

  return {
    kind: 'template',
    info,
    columns,
    items,
    layout: normalizeLayout(['image', ...order], columns),
    notes: [`قالب كاسب: ${items.length} بند${columns.length ? ` و${columns.length} عمود إضافي` : ''}`],
  }
}

// ─── 2. any other BOQ ──────────────────────────────────────────────────────

const HEAD: Array<{ key: 'description' | 'quantity' | 'unit' | 'unit_price' | 'details' | 'amount' | 'no'; re: RegExp }> = [
  { key: 'amount', re: /^(amount|total|total amount|line total|الإجمالي|الاجمالي|المبلغ|القيمة الإجمالية|المجموع)$/i },
  { key: 'unit_price', re: /\b(rate|unit\s*rate|unit\s*price|price)\b|سعر|الفئة/i },
  { key: 'quantity', re: /\b(qty|quantity|quantities|qnty)\b|الكمية|كمية/i },
  { key: 'unit', re: /^(unit|units|uom|u\.o\.m|الوحدة|وحدة)$/i },
  { key: 'description', re: /\b(description|desc|item description|particulars|scope|works?)\b|الوصف|البيان|وصف|الصنف/i },
  { key: 'details', re: /\b(remarks?|details?|specs?|specification|size|notes?)\b|ملاحظات|تفاصيل|المواصفات|مقاس/i },
  { key: 'no', re: /^(#|no\.?|item|item\s*no\.?|s\.?\s*no\.?|ref\.?|م|رقم|البند|رقم البند|ت)$/i },
]

function headerScore(row: unknown[]): number {
  let s = 0
  for (const cell of row) {
    const t = str(cell)
    if (!t || t.length > 40) continue
    if (HEAD.some((h) => h.re.test(t))) s += 2
    else if (/[\p{L}]/u.test(t) && num(t) === null) s += 0.25
  }
  return s
}

/** The row that holds the column titles — searched, never assumed. */
export function findHeaderRow(grid: Grid): number {
  let best = -1
  let bestScore = 0
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const filled = (grid[r] || []).filter((c) => str(c) !== '').length
    if (filled < 2) continue
    const sc = headerScore(grid[r] || [])
    if (sc > bestScore) { bestScore = sc; best = r }
  }
  if (best >= 0 && bestScore >= 4) return best
  // No recognisable titles: the first row with ≥2 filled cells.
  for (let r = 0; r < grid.length; r++) if ((grid[r] || []).filter((c) => str(c) !== '').length >= 2) return r
  return 0
}

export function parseBoqGrid(grid: Grid, sheetName = ''): ImportResult {
  const h = findHeaderRow(grid)
  const header = (grid[h] || []).map(str)
  const width = Math.max(header.length, ...grid.slice(h + 1, h + 400).map((r) => (r || []).length))
  const role: Array<string | null> = []
  const used = new Set<string>()
  for (let c = 0; c < width; c++) {
    const t = header[c] || ''
    const hit = HEAD.find((x) => x.re.test(t) && !used.has(x.key))
    if (hit && hit.key !== 'no') { role[c] = hit.key; used.add(hit.key) } else role[c] = null
  }
  // No description title: the column with the longest text is the description.
  if (!used.has('description')) {
    let bestC = -1, bestLen = 0
    for (let c = 0; c < width; c++) {
      if (role[c]) continue
      const len = grid.slice(h + 1, h + 200).reduce((n, r) => n + str((r || [])[c]).length, 0)
      if (len > bestLen) { bestLen = len; bestC = c }
    }
    if (bestC >= 0) { role[bestC] = 'description'; used.add('description') }
  }

  const columns: ManualQuoteColumn[] = []
  const colIdByIdx = new Map<number, string>()
  const order: LayoutKey[] = ['image']
  for (let c = 0; c < width; c++) {
    const r = role[c]
    if (r === 'amount') continue // the total is computed, never copied
    if (r === 'description' || r === 'quantity' || r === 'unit' || r === 'unit_price' || r === 'details') { order.push(r); continue }
    const name = header[c] || `عمود ${c + 1}`
    const hasData = grid.slice(h + 1).some((row) => str((row || [])[c]) !== '')
    if (!hasData && !header[c]) continue
    const id = rid()
    columns.push({ id, name: name.slice(0, 60) })
    colIdByIdx.set(c, id)
    order.push(customKey(id))
  }

  const items: ManualQuoteItem[] = []
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] || []
    if (!row.some((c) => str(c) !== '')) continue
    const it: ManualQuoteItem = { id: rid(), description: '', details: '', quantity: 0, unit: '', unit_price: null, imageUrl: null, notes: '', adminNotes: '', custom: {} }
    for (let c = 0; c < width; c++) {
      const v = row[c]
      const id = colIdByIdx.get(c)
      if (id) { const t = str(v); if (t) it.custom![id] = t; continue }
      switch (role[c]) {
        case 'description': it.description = str(v); break
        case 'details': it.details = str(v); break
        case 'quantity': it.quantity = Math.max(0, num(v) ?? 0); break
        case 'unit': it.unit = str(v); break
        case 'unit_price': { const n = num(v); it.unit_price = n === null ? null : Math.max(0, n); break }
      }
    }
    items.push(it)
  }
  return {
    kind: 'boq',
    info: {},
    columns,
    items,
    layout: normalizeLayout(order, columns),
    notes: [`${sheetName ? `«${sheetName}»: ` : ''}${items.length} صف، العناوين في السطر ${h + 1}`],
  }
}

/** Several sheets of one BOQ → one table (columns merged by name, rows appended). */
export function mergeImports(parts: ImportResult[]): ImportResult {
  if (parts.length === 1) return parts[0]
  const byName = new Map<string, ManualQuoteColumn>()
  const columns: ManualQuoteColumn[] = []
  const items: ManualQuoteItem[] = []
  const order: LayoutKey[] = []
  for (const p of parts) {
    const remap = new Map<string, string>()
    for (const c of p.columns) {
      const key = c.name.trim().toLowerCase()
      let target = byName.get(key)
      if (!target) { target = { ...c }; byName.set(key, target); columns.push(target) }
      remap.set(c.id, target.id)
    }
    for (const k of p.layout) {
      const cid = k.startsWith('c:') ? remap.get(k.slice(2)) : null
      const nk = (cid ? customKey(cid) : k) as LayoutKey
      if (!order.includes(nk)) order.push(nk)
    }
    for (const it of p.items) {
      const custom: Record<string, string> = {}
      for (const [k, v] of Object.entries(it.custom || {})) { const t = remap.get(k); if (t) custom[t] = v }
      items.push({ ...it, custom })
    }
  }
  return { kind: parts[0].kind, info: parts[0].info, columns, items, layout: normalizeLayout(order, columns), notes: parts.flatMap((p) => p.notes) }
}
