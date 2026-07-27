// "عروض يدوية" — hand-built quotations, kept entirely in S3 (no DB columns).
//
// A lightweight quotation builder separate from the Furn engine: the team enters
// the client, adds priced line items (each with an optional thumbnail), and the
// number runs from 100 upward. Rendered/printed from /print/manual-quote/<id>.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/manual-quotes.json'
const START_NUMBER = 100 // the owner's ask: numbering starts at 100

export type QuoteLang = 'ar' | 'en'
export type QuoteCurrency = 'SAR' | 'USD'

export interface ManualQuoteItem {
  id: string
  description: string
  details: string
  quantity: number
  unit: string
  unit_price: number | null
  imageUrl: string | null // small per-line image (manual upload)
}

export interface ManualQuote {
  id: string
  number: number
  language: QuoteLang
  client_name: string
  company: string
  email: string
  phone: string
  currency: QuoteCurrency
  vat_rate: number
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
    quotes: Array.isArray(s?.quotes) ? s.quotes : [],
    nextNumber: Number.isFinite(s?.nextNumber) && s.nextNumber >= START_NUMBER ? s.nextNumber : START_NUMBER,
  }
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
  const s = await read()
  const now = new Date().toISOString()
  const q: ManualQuote = {
    id: rid(),
    number: s.nextNumber,
    language: 'ar',
    client_name: '', company: '', email: '', phone: '',
    currency: 'SAR',
    vat_rate: 0.15,
    items: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
  }
  s.quotes.push(q)
  s.nextNumber = s.nextNumber + 1
  await writeJson(KEY, s)
  return q
}

const CURRENCIES: QuoteCurrency[] = ['SAR', 'USD']

// Sanitise + persist an edit. The number, id and audit stamps are never client-
// writable; everything else is replaced from the patch.
export async function updateManualQuote(id: string, patch: Partial<ManualQuote>): Promise<ManualQuote | null> {
  const s = await read()
  const idx = s.quotes.findIndex((q) => q.id === id)
  if (idx < 0) return null
  const cur = s.quotes[idx]

  const items: ManualQuoteItem[] = Array.isArray(patch.items)
    ? patch.items.slice(0, 500).map((raw) => {
        const it = raw as Partial<ManualQuoteItem>
        const qty = Number(it.quantity)
        const price = it.unit_price === null || it.unit_price === undefined ? null : Number(it.unit_price)
        return {
          id: typeof it.id === 'string' && it.id ? it.id : rid(),
          description: String(it.description || '').slice(0, 400),
          details: String(it.details || '').slice(0, 1000),
          quantity: Number.isFinite(qty) ? Math.max(0, qty) : 0,
          unit: String(it.unit || '').slice(0, 20),
          unit_price: price !== null && Number.isFinite(price) ? Math.max(0, price) : null,
          imageUrl: typeof it.imageUrl === 'string' && it.imageUrl ? it.imageUrl.slice(0, 1000) : null,
        }
      })
    : cur.items

  const next: ManualQuote = {
    ...cur,
    language: patch.language === 'en' ? 'en' : patch.language === 'ar' ? 'ar' : cur.language,
    client_name: patch.client_name !== undefined ? String(patch.client_name).slice(0, 200) : cur.client_name,
    company: patch.company !== undefined ? String(patch.company).slice(0, 200) : cur.company,
    email: patch.email !== undefined ? String(patch.email).slice(0, 200) : cur.email,
    phone: patch.phone !== undefined ? String(patch.phone).slice(0, 60) : cur.phone,
    currency: patch.currency && CURRENCIES.includes(patch.currency) ? patch.currency : cur.currency,
    vat_rate: typeof patch.vat_rate === 'number' && patch.vat_rate >= 0 && patch.vat_rate <= 1 ? patch.vat_rate : cur.vat_rate,
    items,
    notes: patch.notes !== undefined ? String(patch.notes).slice(0, 4000) : cur.notes,
    updatedAt: new Date().toISOString(),
  }
  s.quotes[idx] = next
  await writeJson(KEY, s)
  return next
}

export async function deleteManualQuote(id: string): Promise<boolean> {
  const s = await read()
  const before = s.quotes.length
  s.quotes = s.quotes.filter((q) => q.id !== id)
  if (s.quotes.length === before) return false
  await writeJson(KEY, s)
  return true
}
