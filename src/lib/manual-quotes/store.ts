// "عروض يدوية" — hand-built quotations, kept entirely in S3 (no DB columns).
//
// A lightweight quotation builder separate from the Furn engine: the team enters
// the client, adds priced line items (each with an optional thumbnail), and the
// number runs from 100 upward. Rendered/printed from /print/manual-quote/<id>.

import { normalizeLayout, STD_KEYS, type LayoutKey, type StdKey } from './layout'
import { readJson, mutateJson } from '@/lib/s3'

const KEY = 'app-data/manual-quotes.json'
const START_NUMBER = 100 // the owner's ask: numbering starts at 100

export type QuoteLang = 'ar' | 'en'
export type QuoteCurrency = 'SAR' | 'USD'
// Delivery handling on the quote:
//   none     → say nothing about delivery
//   included → print a "price includes delivery" note (no extra charge)
//   excluded → add a priced delivery line (shipping amount, VAT applies)
export type QuoteDelivery = 'none' | 'included' | 'excluded'

// A team-defined extra column (e.g. "المقاس", "الكود") that renders on the PDF.
export interface ManualQuoteColumn {
  id: string
  name: string
  /** Management-only: kept in the editor, never printed on the quotation. */
  internal?: boolean
}

export interface ManualQuoteItem {
  id: string
  description: string
  details: string
  quantity: number
  unit: string
  unit_price: number | null
  imageUrl: string | null // small per-line image (manual upload)
  notes?: string // team note — prints in the quote's Notes column
  /** Management-only note — never reaches the client. */
  adminNotes?: string
  // Values for the quote's custom columns, keyed by column id.
  custom?: Record<string, string>
}

export interface ManualQuote {
  id: string
  number: number
  language: QuoteLang
  project_name: string
  subject: string
  client_name: string
  company: string
  email: string
  phone: string
  currency: QuoteCurrency
  vat_rate: number
  // Delivery/shipping handling (see QuoteDelivery). `shipping` is only used when
  // delivery === 'excluded' — the priced delivery line amount.
  delivery: QuoteDelivery
  shipping: number
  // Extra named columns (beyond the standard ones). `internal` ones are for the
  // management only and never print.
  columns: ManualQuoteColumn[]
  /** Column order of the table (standard + "c:<id>") — see lib/manual-quotes/layout. */
  layout: LayoutKey[]
  /** Standard columns hidden from the printed quotation. */
  hidden: StdKey[]
  items: ManualQuoteItem[]
  notes: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
  createdByName: string | null
}

interface State {
  quotes: ManualQuote[]
  nextNumber: number
}

const EMPTY: State = { quotes: [], nextNumber: START_NUMBER }

async function read(): Promise<State> {
  const s = await readJson<State>(KEY, EMPTY)
  return {
    // Backfill `columns` on older quotes so consumers can always map over it.
    quotes: Array.isArray(s?.quotes) ? s.quotes.map((q) => ({
      ...q,
      columns: Array.isArray(q?.columns) ? q.columns : [],
      layout: normalizeLayout(q?.layout, Array.isArray(q?.columns) ? q.columns : []),
      hidden: cleanHidden(q?.hidden),
      delivery: q?.delivery === 'included' || q?.delivery === 'excluded' ? q.delivery : 'none',
      shipping: Number.isFinite(q?.shipping) ? Number(q.shipping) : 0,
    })) : [],
    nextNumber: Number.isFinite(s?.nextNumber) && s.nextNumber >= START_NUMBER ? s.nextNumber : START_NUMBER,
  }
}

const HIDEABLE = new Set<string>(STD_KEYS.filter((k) => k !== 'adminNotes'))
function cleanHidden(v: unknown): StdKey[] {
  return Array.from(new Set((Array.isArray(v) ? v : []).map(String).filter((k) => HIDEABLE.has(k)))) as StdKey[]
}

function rid(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`
}

export async function listManualQuotes(): Promise<ManualQuote[]> {
  const s = await read()
  return [...s.quotes].sort((a, b) => b.number - a.number)
}

export async function getManualQuote(id: string): Promise<ManualQuote | null> {
  return (await read()).quotes.find((q) => q.id === id) ?? null
}

export async function createManualQuote(input: {
  createdBy: string | null
  createdByName: string | null
}): Promise<ManualQuote> {
  const now = new Date().toISOString()
  let created: ManualQuote | null = null
  // Atomic allocate-and-append so two people creating a quote at once can't be
  // handed the SAME number (last-write-wins would drop one and duplicate the #).
  await mutateJson<State>(KEY, EMPTY, (raw) => {
    const quotes = Array.isArray(raw?.quotes) ? raw.quotes : []
    const nextNumber = Number.isFinite(raw?.nextNumber) && raw.nextNumber >= START_NUMBER ? raw.nextNumber : START_NUMBER
    const q: ManualQuote = {
      id: rid(),
      number: nextNumber,
      language: 'en', // default to English quotations (owner's request)
      project_name: '', subject: '',
      client_name: '', company: '', email: '', phone: '',
      currency: 'SAR',
      vat_rate: 0.15,
      delivery: 'none',
      shipping: 0,
      columns: [],
      layout: normalizeLayout(null, []),
      hidden: [],
      items: [],
      notes: '',
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    }
    created = q
    return { quotes: [...quotes, q], nextNumber: nextNumber + 1 }
  })
  if (!created) throw new Error('createManualQuote: write did not run')
  return created
}

/**
 * Copy an existing quote into a NEW one: next number, the title the team
 * typed, everything else as it was (items, columns, layout, settings) so it
 * can be edited freely. Atomic, like create.
 */
export async function duplicateManualQuote(sourceId: string, input: {
  subject: string
  createdBy: string | null
  createdByName: string | null
}): Promise<ManualQuote | null> {
  const now = new Date().toISOString()
  let created: ManualQuote | null = null
  await mutateJson<State>(KEY, EMPTY, (raw) => {
    const quotes = Array.isArray(raw?.quotes) ? raw.quotes : []
    const src = quotes.find((q) => q.id === sourceId)
    if (!src) return raw
    const nextNumber = Number.isFinite(raw?.nextNumber) && raw.nextNumber >= START_NUMBER ? raw.nextNumber : START_NUMBER
    const columns = Array.isArray(src.columns) ? src.columns.map((c) => ({ ...c })) : []
    const q: ManualQuote = {
      ...src,
      id: rid(),
      number: nextNumber,
      subject: input.subject.slice(0, 300),
      columns,
      layout: normalizeLayout(src.layout, columns),
      hidden: cleanHidden(src.hidden),
      items: (Array.isArray(src.items) ? src.items : []).map((it) => ({ ...it, id: rid(), custom: it.custom ? { ...it.custom } : undefined })),
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
    }
    created = q
    return { quotes: [...quotes, q], nextNumber: nextNumber + 1 }
  })
  return created
}

const CURRENCIES: QuoteCurrency[] = ['SAR', 'USD']

// Sanitise + persist an edit. The number, id and audit stamps are never client-
// writable; everything else is replaced from the patch.
// Sanitise + persist an edit. The number, id and audit stamps are never client-
// writable; everything else is replaced from the patch.
//
// ATOMIC (mutateJson): this used to read the whole store, change one quote and
// write the whole store back — a quote created by someone else in between was
// silently erased. With autosave firing every few seconds that window is real.
export async function updateManualQuote(id: string, patch: Partial<ManualQuote>): Promise<ManualQuote | null> {
  let result: ManualQuote | null = null
  await mutateJson<State>(KEY, EMPTY, (raw) => {
    const quotes = Array.isArray(raw?.quotes) ? raw.quotes : []
    const idx = quotes.findIndex((q) => q.id === id)
    if (idx < 0) { result = null; return raw }
    const next = applyPatch(quotes[idx], patch)
    result = next
    const copy = quotes.slice()
    copy[idx] = next
    return { ...raw, quotes: copy }
  })
  return result
}

function applyPatch(curRaw: ManualQuote, patch: Partial<ManualQuote>): ManualQuote {
  const cur: ManualQuote = {
    ...curRaw,
    columns: Array.isArray(curRaw.columns) ? curRaw.columns : [],
    layout: normalizeLayout(curRaw.layout, Array.isArray(curRaw.columns) ? curRaw.columns : []),
    hidden: cleanHidden(curRaw.hidden),
  }

  // Custom columns first (item.custom is validated against these ids).
  const columns: ManualQuoteColumn[] = Array.isArray(patch.columns)
    ? patch.columns.slice(0, 60).map((raw, i) => {
        const c = raw as Partial<ManualQuoteColumn>
        // A blank name gets a fallback rather than dropping the column — deleting
        // is the X button's job (it removes the column from the array). Dropping
        // a blank-named column here would silently wipe all its per-item data.
        const nm = String(c.name || '').trim()
        return {
          id: typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : rid(),
          name: (nm || `عمود ${i + 1}`).slice(0, 60),
          ...(c.internal === true ? { internal: true } : {}),
        }
      })
    : cur.columns
  const colIds = new Set(columns.map((c) => c.id))

  const items: ManualQuoteItem[] = Array.isArray(patch.items)
    ? patch.items.slice(0, 1000).map((raw) => {
        const it = raw as Partial<ManualQuoteItem>
        const qty = Number(it.quantity)
        const price = it.unit_price === null || it.unit_price === undefined ? null : Number(it.unit_price)
        let custom: Record<string, string> | undefined
        if (it.custom && typeof it.custom === 'object') {
          custom = {}
          for (const [k, v] of Object.entries(it.custom)) {
            if (colIds.has(k)) custom[k] = String(v ?? '').slice(0, 500)
          }
        }
        return {
          id: typeof it.id === 'string' && it.id ? it.id : rid(),
          description: String(it.description || '').slice(0, 1000),
          details: String(it.details || '').slice(0, 2000),
          quantity: Number.isFinite(qty) ? Math.max(0, qty) : 0,
          unit: String(it.unit || '').slice(0, 30),
          unit_price: price !== null && Number.isFinite(price) ? Math.max(0, price) : null,
          imageUrl: typeof it.imageUrl === 'string' && it.imageUrl ? it.imageUrl.slice(0, 1000) : null,
          notes: String(it.notes || '').slice(0, 1000),
          adminNotes: String(it.adminNotes || '').slice(0, 2000),
          ...(custom ? { custom } : {}),
        }
      })
    : cur.items

  return {
    ...cur,
    language: patch.language === 'en' ? 'en' : patch.language === 'ar' ? 'ar' : cur.language,
    project_name: patch.project_name !== undefined ? String(patch.project_name).slice(0, 200) : (cur.project_name ?? ''),
    subject: patch.subject !== undefined ? String(patch.subject).slice(0, 300) : (cur.subject ?? ''),
    client_name: patch.client_name !== undefined ? String(patch.client_name).slice(0, 200) : cur.client_name,
    company: patch.company !== undefined ? String(patch.company).slice(0, 200) : cur.company,
    email: patch.email !== undefined ? String(patch.email).slice(0, 200) : cur.email,
    phone: patch.phone !== undefined ? String(patch.phone).slice(0, 60) : cur.phone,
    currency: patch.currency && CURRENCIES.includes(patch.currency) ? patch.currency : cur.currency,
    vat_rate: typeof patch.vat_rate === 'number' && patch.vat_rate >= 0 && patch.vat_rate <= 1 ? patch.vat_rate : cur.vat_rate,
    delivery: patch.delivery === 'included' || patch.delivery === 'excluded' || patch.delivery === 'none' ? patch.delivery : (cur.delivery ?? 'none'),
    shipping: typeof patch.shipping === 'number' && patch.shipping >= 0 ? patch.shipping : (cur.shipping ?? 0),
    columns,
    layout: normalizeLayout(patch.layout !== undefined ? patch.layout : cur.layout, columns),
    hidden: patch.hidden !== undefined ? cleanHidden(patch.hidden) : cur.hidden,
    items,
    notes: patch.notes !== undefined ? String(patch.notes).slice(0, 4000) : cur.notes,
    updatedAt: new Date().toISOString(),
  }
}

export async function deleteManualQuote(id: string): Promise<boolean> {
  let removed = false
  await mutateJson<State>(KEY, EMPTY, (raw) => {
    const quotes = Array.isArray(raw?.quotes) ? raw.quotes : []
    const next = quotes.filter((q) => q.id !== id)
    removed = next.length !== quotes.length
    return removed ? { ...raw, quotes: next } : raw
  })
  return removed
}
