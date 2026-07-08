// Tannoor product extras that the DB table is MISSING (color_en, color_ar,
// thickness_mm, finish columns don't exist), kept in a JSON object in S3 so the
// product save only ever writes columns that actually exist — no migration, no
// 500s. Holds: a saved colour palette, per-product colours (multi-select), and
// per-product thickness + finish.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/tannoor-colors.json'

export interface ProductAttrs { thickness_mm: number | null; finish: string | null }

export interface ColorStore {
  palette: string[]
  byProduct: Record<string, string[]>        // productId → colours
  attrs: Record<string, ProductAttrs>         // productId → thickness + finish
}

const DEFAULT_PALETTE = [
  'أبيض', 'أسود', 'رمادي', 'بيج', 'بني', 'ذهبي', 'أخضر', 'أحمر', 'أزرق', 'وردي', 'كريمي', 'فضي',
]

async function read(): Promise<ColorStore> {
  const d = await readJson<Partial<ColorStore>>(KEY, {})
  return {
    palette: d.palette && d.palette.length ? d.palette : [...DEFAULT_PALETTE],
    byProduct: d.byProduct || {},
    attrs: d.attrs || {},
  }
}

export async function getColors(): Promise<ColorStore> {
  return read()
}

export interface ProductExtrasInput {
  colors?: string[]
  thickness_mm?: number | null
  finish?: string | null
}

// Set a product's colours + thickness + finish in one call; new colours join
// the palette.
export async function setProductExtras(productId: string, input: ProductExtrasInput): Promise<ColorStore> {
  const s = await read()

  const clean = [...new Set((input.colors || []).map(c => c.trim()).filter(Boolean))]
  if (clean.length) s.byProduct[productId] = clean
  else delete s.byProduct[productId]
  for (const c of clean) if (!s.palette.includes(c)) s.palette.push(c)

  const thickness = input.thickness_mm == null ? null : Number(input.thickness_mm)
  const finish = (input.finish || '').trim() || null
  if (thickness != null || finish) s.attrs[productId] = { thickness_mm: Number.isFinite(thickness as number) ? thickness : null, finish }
  else delete s.attrs[productId]

  await writeJson(KEY, s)
  return s
}
