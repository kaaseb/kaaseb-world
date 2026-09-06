// POST /api/tannoor/projects/[id]/quote
// Locks the auto-priced items into a quotation. Refuses if any item is
// still flagged missing — the team must catalog those products first.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getFxSettings, usdPrice } from '@/lib/settings/fx'
import { resolveShipping } from '@/lib/furn/delivery-store'
import { computeTotals } from '@/lib/quotation/totals'
import { reconcileQuotationRows } from '@/lib/quotation/reconcile'

const VAT_RATE = 0.15

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('tannoor.quotation.export')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { language?: 'ar' | 'en'; currency?: 'SAR' | 'USD' }
  try { body = await request.json() } catch { body = {} }
  const language = body.language === 'en' ? 'en' : 'ar'
  const currency = body.currency === 'USD' ? 'USD' : 'SAR'

  const [{ data: project }, { data: items }] = await Promise.all([
    supabase.from('tannoor_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('tannoor_items').select('*, tannoor_products(price_sar, price_usd)').eq('project_id', id).order('position'),
  ])
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!items || items.length === 0) return NextResponse.json({ error: 'No items to quote' }, { status: 400 })

  const missing = items.filter(it => it.is_missing || !it.product_id)
  if (missing.length > 0) {
    return NextResponse.json({
      error: `${missing.length} item(s) still flagged as missing. Add them in Tannoor → Products first.`,
    }, { status: 400 })
  }

  // Totals come from each line's edited unit_price (single-currency project),
  // falling back to the catalog price in the requested currency if a line was
  // never priced. In a rate mode the USD fallback is DERIVED from the SAR price
  // at the configured rate rather than read from the (drift-prone) price_usd
  // column — the setting exists precisely so the second column stops mattering.
  const fx = await getFxSettings()
  type ItemRow = typeof items[number] & { tannoor_products?: { price_sar: number; price_usd: number } | null }
  const lines = (items as ItemRow[]).map((it) => {
    const sar = it.tannoor_products?.price_sar ?? 0
    const usd = it.tannoor_products?.price_usd ?? 0
    const fallback = currency === 'USD' ? (usdPrice(fx, sar, usd) ?? 0) : sar
    return { quantity: it.quantity, unit_price: it.unit_price ?? fallback }
  })
  // Delivery "not included" = a priced shipping line inside the subtotal — the
  // same store and rule Furn uses (keyed by project id). ONE totals function.
  const shipping = await resolveShipping(id)
  const totals = computeTotals(lines, shipping, VAT_RATE)

  // Re-issue REPLACES: one number per project, one row per language (the shared
  // helper with Furn) — regenerating never stacks a new quotation on the old.
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  let quote: Record<string, unknown>
  try {
    const rec = await reconcileQuotationRows({
      db: admin,
      table: 'tannoor_quotations',
      projectId: id,
      writeLanguages: [language],
      allocate: async () => {
        const { data: settings } = await admin
          .from('furn_settings').select('next_tannoor_number').eq('id', 1).single()
        const number = settings?.next_tannoor_number || 5000
        await admin.from('furn_settings')
          .update({ next_tannoor_number: number + 1, updated_at: nowIso })
          .eq('id', 1)
        return number
      },
      build: () => ({
        currency,
        vat_rate: VAT_RATE,
        subtotal: totals.subtotal,
        vat_amount: totals.vat,
        total: totals.total,
        generated_by: user.id,
        generated_at: nowIso,
      }),
    })
    quote = rec.rows[0]
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save quotation' }, { status: 500 })
  }

  await supabase.from('tannoor_projects').update({
    stage: 'quoted', status: 'completed', updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ quotation: quote })
}
