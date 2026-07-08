// "Delivery" feature store (local JSON — works with no Supabase/SQL access).
//
// Per project the team picks one of three options on the quotation:
//   • included  → print a fixed sentence (from settings) in the terms.
//   • excluded  → add a SHIPPING line item priced into the subtotal + total.
//   • none      → print nothing.
//
// So we keep: the included sentence (presets, bilingual), and per-project the
// choice + the shipping amount (used when excluded).

import { readJson, writeJson } from '@/lib/s3'

export interface DeliveryPresets {
  included_ar: string
  included_en: string
}

export type DeliveryChoice = 'included' | 'excluded' | 'none'

interface DeliveryData {
  presets: DeliveryPresets
  choices: Record<string, DeliveryChoice>
  shipping: Record<string, number>
}

const KEY = 'app-data/furn-delivery.json'

export const DEFAULT_DELIVERY_PRESETS: DeliveryPresets = {
  included_ar: 'الأسعار شاملة التوصيل إلى الموقع.',
  included_en: 'Prices are inclusive of delivery to site.',
}

async function read(): Promise<DeliveryData> {
  const d = await readJson<Partial<DeliveryData>>(KEY, {})
  return {
    presets: { ...DEFAULT_DELIVERY_PRESETS, ...(d.presets || {}) },
    choices: d.choices || {},
    shipping: d.shipping || {},
  }
}

async function write(d: DeliveryData): Promise<void> {
  await writeJson(KEY, d)
}

export async function getDeliveryPresets(): Promise<DeliveryPresets> {
  return (await read()).presets
}

export async function setDeliveryPresets(patch: Partial<DeliveryPresets>): Promise<DeliveryPresets> {
  const d = await read()
  d.presets = { ...d.presets, ...patch }
  await write(d)
  return d.presets
}

// Read a project's full delivery decision (choice + shipping amount).
export async function getDelivery(projectId: string): Promise<{ choice: DeliveryChoice; shipping: number }> {
  const d = await read()
  return { choice: d.choices[projectId] || 'none', shipping: Number(d.shipping[projectId] || 0) }
}

export async function setDelivery(projectId: string, choice: DeliveryChoice, shipping: number): Promise<void> {
  const d = await read()
  if (choice === 'none') {
    delete d.choices[projectId]
    delete d.shipping[projectId]
  } else {
    d.choices[projectId] = choice
    if (choice === 'excluded') d.shipping[projectId] = Math.max(0, Number(shipping) || 0)
    else delete d.shipping[projectId]
  }
  await write(d)
}

// The "included" sentence to print, or null. Only "included" prints a sentence;
// "excluded" is handled as a priced shipping line, "none" prints nothing.
export async function resolveDeliveryNote(projectId: string, lang: 'ar' | 'en'): Promise<string | null> {
  const d = await read()
  if ((d.choices[projectId] || 'none') !== 'included') return null
  return (lang === 'ar' ? d.presets.included_ar : d.presets.included_en) || null
}

// Shipping amount to add to the quote total (0 unless the project is "excluded").
export async function resolveShipping(projectId: string): Promise<number> {
  const d = await read()
  if ((d.choices[projectId] || 'none') !== 'excluded') return 0
  return Number(d.shipping[projectId] || 0)
}
