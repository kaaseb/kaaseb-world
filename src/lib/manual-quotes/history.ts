// Version history of a manual quote — who changed what, and when.
//
//   app-data/manual-quote-history/<quoteId>.json → HistoryEntry[] (newest first)
//
// Every save is recorded, but the editor autosaves every ~2 seconds, so one
// person's edits within 10 minutes are COALESCED into one entry whose change
// list is the NET difference since that entry began (edit a price then change
// it back → nothing to show). Each entry keeps a snapshot of the quote as it
// was BEFORE it, so any version can be restored. Shown only on request.

import { randomBytes } from 'node:crypto'
import { readJson, mutateJson } from '@/lib/s3'
import type { ManualQuote, ManualQuoteItem } from './store'

export type HistorySource = 'editor' | 'chat' | 'restore'

export interface QuoteChange {
  /** What changed, in words: "سعر الوحدة", "بند جديد", "العميل"… */
  label: string
  /** Which line (1-based position + short description) — item changes only. */
  item?: string
  before?: string
  after?: string
}

export interface HistoryEntry {
  id: string
  at: string
  lastAt: string
  by: string
  byName: string
  source: HistorySource
  changes: QuoteChange[]
  /** The quote BEFORE this entry — restoring an entry returns to this. */
  snapshot: ManualQuote
}

const MAX_ENTRIES = 60
const COALESCE_MS = 10 * 60 * 1000
const key = (quoteId: string) => {
  if (!/^[\w-]{6,80}$/.test(quoteId)) throw new Error('bad quote id')
  return `app-data/manual-quote-history/${quoteId}.json`
}

// ── diff ─────────────────────────────────────────────────────────────────────
const QUOTE_FIELDS: Array<[keyof ManualQuote, string]> = [
  ['subject', 'العنوان'], ['project_name', 'المشروع'], ['company', 'الشركة'], ['client_name', 'العميل'],
  ['email', 'الإيميل'], ['phone', 'الجوال'], ['currency', 'العملة'], ['language', 'اللغة'],
  ['vat_rate', 'الضريبة'], ['delivery', 'التوصيل'], ['shipping', 'رسوم التوصيل'], ['notes', 'الملاحظات'],
]
const ITEM_FIELDS: Array<[keyof ManualQuoteItem, string]> = [
  ['description', 'الوصف'], ['details', 'التفاصيل'], ['quantity', 'الكمية'], ['unit', 'الوحدة'],
  ['unit_price', 'سعر الوحدة'], ['notes', 'الملاحظات'], ['adminNotes', 'ملاحظة الإدارة'], ['imageUrl', 'الصورة'],
]

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'vat_rate') return Number(v) ? `${Math.round(Number(v) * 100)}%` : 'بدون'
  if (field === 'delivery') return v === 'included' ? 'شامل' : v === 'excluded' ? 'غير شامل' : 'بدون'
  if (field === 'language') return v === 'en' ? 'English' : 'عربي'
  if (field === 'imageUrl') return 'صورة'
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s) || 'بند'

/** Human differences between two versions of the same quote. Pure. */
export function diffQuotes(before: ManualQuote, after: ManualQuote): QuoteChange[] {
  const out: QuoteChange[] = []
  for (const [f, label] of QUOTE_FIELDS) {
    if (!same(before[f], after[f])) out.push({ label, before: show(f, before[f]), after: show(f, after[f]) })
  }

  const colName = new Map<string, string>()
  for (const c of [...(before.columns || []), ...(after.columns || [])]) colName.set(c.id, c.internal ? `${c.name} (للإدارة)` : c.name)
  const beforeCols = new Set((before.columns || []).map((c) => c.id))
  const afterCols = new Set((after.columns || []).map((c) => c.id))
  for (const c of after.columns || []) if (!beforeCols.has(c.id)) out.push({ label: 'عمود جديد', after: colName.get(c.id) })
  for (const c of before.columns || []) if (!afterCols.has(c.id)) out.push({ label: 'حذف عمود', before: colName.get(c.id) })
  for (const c of after.columns || []) {
    const old = (before.columns || []).find((x) => x.id === c.id)
    if (old && old.name !== c.name) out.push({ label: 'اسم عمود', before: old.name, after: c.name })
  }

  const oldById = new Map((before.items || []).map((i, n) => [i.id, { i, n }]))
  const newIds = new Set((after.items || []).map((i) => i.id))
  ;(after.items || []).forEach((it, n) => {
    const prev = oldById.get(it.id)
    const where = `${n + 1}. ${short(it.description)}`
    if (!prev) { out.push({ label: 'بند جديد', item: where, after: [it.description, it.quantity ? `الكمية ${it.quantity} ${it.unit}` : '', it.unit_price != null ? `السعر ${it.unit_price}` : ''].filter(Boolean).join(' — ') }); return }
    for (const [f, label] of ITEM_FIELDS) {
      if (!same(prev.i[f], it[f])) out.push({ label, item: where, before: show(f, prev.i[f]), after: show(f, it[f]) })
    }
    const ids = new Set([...Object.keys(prev.i.custom || {}), ...Object.keys(it.custom || {})])
    for (const id of ids) {
      if (!afterCols.has(id)) continue // the column itself was removed — reported once above
      const a = prev.i.custom?.[id]; const b = it.custom?.[id]
      if (!same(a, b)) out.push({ label: colName.get(id) || 'عمود', item: where, before: show('', a), after: show('', b) })
    }
  })
  for (const [id, { i, n }] of oldById) if (!newIds.has(id)) out.push({ label: 'حذف بند', item: `${n + 1}. ${short(i.description)}`, before: i.description })

  const order = (q: ManualQuote) => (q.items || []).filter((i) => oldById.has(i.id) && newIds.has(i.id)).map((i) => i.id).join(',')
  if (order(before) !== order(after) && out.every((c) => c.label !== 'بند جديد' && c.label !== 'حذف بند')) out.push({ label: 'ترتيب البنود' })
  return out
}

// ── store ────────────────────────────────────────────────────────────────────
export async function getHistory(quoteId: string): Promise<HistoryEntry[]> {
  const list = await readJson<HistoryEntry[]>(key(quoteId), [])
  return Array.isArray(list) ? list : []
}

/** Record one save. Pure-diff; coalesces the same person's editor saves. */
export async function recordChange(
  before: ManualQuote,
  after: ManualQuote,
  actor: { id: string; name: string; source: HistorySource },
): Promise<void> {
  const now = new Date().toISOString()
  await mutateJson<HistoryEntry[]>(key(after.id), [], (cur) => {
    const list = Array.isArray(cur) ? cur.slice() : []
    const last = list[0]
    const canMerge = actor.source === 'editor' && last && last.source === 'editor' && last.by === actor.id &&
      Date.now() - new Date(last.lastAt).getTime() < COALESCE_MS
    if (canMerge) {
      const changes = diffQuotes(last.snapshot, after)
      if (!changes.length) return list.slice(1) // edited back to where it started
      list[0] = { ...last, lastAt: now, changes }
      return list
    }
    const changes = diffQuotes(before, after)
    if (!changes.length) return list
    const entry: HistoryEntry = { id: randomBytes(8).toString('hex'), at: now, lastAt: now, by: actor.id, byName: actor.name, source: actor.source, changes, snapshot: before }
    return [entry, ...list].slice(0, MAX_ENTRIES)
  })
}
