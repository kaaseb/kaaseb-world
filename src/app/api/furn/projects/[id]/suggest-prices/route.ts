// GET /api/furn/projects/[id]/suggest-prices
//
// SUGGESTED unit prices for a Furn project's items — suggestions, never
// decisions. Nothing is written: the team sees each proposal with its basis
// and confidence and applies it with a click (or ignores it). Two sources,
// both deterministic and free (no AI call):
//
//   catalog  → the catalogue VARIANT the line most likely is (colour + finish +
//              thickness + unit), via the shared matcher. Price = that SKU's SAR.
//   history  → the median of what WE priced similar lines at in earlier
//              quotations (same unit family), when no confident SKU exists.
//
// Read-gated on page.furn (it reveals catalogue prices to Furn users only).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getColors } from '@/lib/tannoor/colors'
import { thicknessFromText } from '@/lib/boq/router/core'
import { matchVariant, tokens, type CatalogVariant } from '@/lib/quotation/match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface PriceSuggestion {
  price: number
  currency: 'SAR'
  basis: 'catalog' | 'history'
  /** Why — shown next to the number ("مطابق كتالوج: Black Galaxy · polished · 20mm"). */
  label: string
  confidence: number
  product_id?: string
  sample?: number
}

const HISTORY_LIMIT = 400
const HISTORY_MIN_SIMILARITY = 0.5

function unitFamily(u: string): string {
  const n = (u || '').toLowerCase().replace(/[²]/g, '2').trim()
  if (['m2', 'sqm', 'sm', 'م2'].includes(n)) return 'area'
  if (['m', 'lm', 'mt', 'rm', 'متر', 'م', 'مط'].includes(n)) return 'length'
  if (['pcs', 'pc', 'no', 'nos', 'ea', 'unit', 'set', 'عدد'].includes(n)) return 'count'
  return n || 'other'
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const A = new Set(a), B = new Set(b)
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

function median(nums: number[]): number {
  const s = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deny = await denyUnlessPermitted('page.furn')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()

  const [{ data: items }, { data: products }, { data: departments }, { data: history }, colours] = await Promise.all([
    supabase.from('furn_items').select('id, description, details, unit, unit_price').eq('project_id', id).order('position'),
    supabase.from('tannoor_products').select('*'),
    supabase.from('furn_departments').select('id, name_en, name_ar'),
    supabase.from('furn_items').select('description, details, unit, unit_price, project_id')
      .not('unit_price', 'is', null).neq('project_id', id)
      .order('updated_at', { ascending: false }).limit(HISTORY_LIMIT),
    getColors(),
  ])

  const deptName = new Map((departments || []).map((d) => [d.id as string, (d.name_en as string) || (d.name_ar as string) || '']))
  type P = { id: string; name_en: string | null; name_ar: string | null; department_id: string | null; unit: string; price_sar: number; price_usd: number; color_en?: string | null; color_ar?: string | null; finish?: string | null; thickness_mm?: number | null }
  const catalog: CatalogVariant[] = ((products || []) as P[]).map((p) => ({
    id: p.id,
    name: [p.name_en, p.name_ar].filter(Boolean).join(' '),
    // Colours + finish + thickness live in S3 (the table's columns are not live);
    // fall back to the columns if a row happens to carry them.
    colours: Array.from(new Set([...(colours.byProduct[p.id] || []), p.color_en || '', p.color_ar || ''].filter(Boolean))),
    finish: colours.attrs[p.id]?.finish ?? p.finish ?? null,
    thickness_mm: colours.attrs[p.id]?.thickness_mm ?? (p.thickness_mm == null ? null : Number(p.thickness_mm)),
    unit: p.unit,
    price_sar: Number(p.price_sar) || 0,
    price_usd: Number(p.price_usd) || 0,
    department: p.department_id ? deptName.get(p.department_id) || null : null,
  })).filter((v) => v.price_sar > 0)

  type H = { description: string; details: string | null; unit: string; unit_price: number }
  const hist = ((history || []) as H[]).map((h) => ({ ...h, toks: tokens(`${h.description} ${h.details || ''}`), fam: unitFamily(h.unit) }))

  const suggestions: Record<string, PriceSuggestion> = {}
  for (const it of (items || []) as Array<{ id: string; description: string; details: string | null; unit: string }>) {
    const text = `${it.description} ${it.details || ''}`
    const match = matchVariant(text, { thickness_mm: thicknessFromText(it.details) ?? thicknessFromText(it.description) }, catalog)
    if (match) {
      suggestions[it.id] = {
        price: match.variant.price_sar, currency: 'SAR', basis: 'catalog',
        label: `مطابق كتالوج: ${match.reasons.join(' · ')}`,
        confidence: Math.round(match.score * 100) / 100, product_id: match.product_id,
      }
      continue
    }
    const mine = tokens(text)
    const fam = unitFamily(it.unit)
    const similar = hist
      .filter((h) => h.fam === fam)
      .map((h) => ({ h, sim: jaccard(mine, h.toks) }))
      .filter((x) => x.sim >= HISTORY_MIN_SIMILARITY)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5)
    if (similar.length > 0) {
      const price = Math.round(median(similar.map((x) => Number(x.h.unit_price))) * 100) / 100
      suggestions[it.id] = {
        price, currency: 'SAR', basis: 'history',
        label: `من ${similar.length} ${similar.length === 1 ? 'عرض سابق' : 'عروض سابقة'} لبنود مشابهة`,
        confidence: Math.min(0.75, 0.4 + 0.08 * similar.length), sample: similar.length,
      }
    }
  }

  return NextResponse.json({ suggestions, catalogSize: catalog.length, historySize: hist.length })
}
