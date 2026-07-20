// POST /api/tannoor/projects/[id]/process
//
// Runs the Tannoor Gemini analyzer:
//   • Pulls products + pricing methods + covered departments.
//   • Sends them along with the BOQ + spec/drawing attachments.
//   • Replaces tannoor_items with the matched lines.
//   • Sets status to 'missing_products' if any line is unmatched (the team
//     should add those products in /tannoor/products and re-run).
//   • Otherwise advances stage='quoted', status='completed' — Tannoor skips
//     the manual pricing step Furn has.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { analyzeTannoorBoq } from '@/lib/tannoor/boq'
import { setProjectItemSources } from '@/lib/tannoor/item-sources'
import { guardItem } from '@/lib/boq/department-guard'
import { friendlyAiError } from '@/lib/ai/friendly-error'
import { getFxSettings, usdPrice } from '@/lib/settings/fx'
import { getColors } from '@/lib/tannoor/colors'
import type { TannoorProduct, FurnDepartment } from '@/types'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project, error: pErr } = await supabase
    .from('tannoor_projects').select('*').eq('id', id).single()
  if (pErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.boq_url) return NextResponse.json({ error: 'No BOQ uploaded' }, { status: 400 })

  const [{ data: products }, { data: departments }] = await Promise.all([
    supabase.from('tannoor_products').select('*'),
    supabase.from('furn_departments').select('*').eq('enabled', true),
  ])

  // Both language names count as ours — the model may answer with either.
  const coveredNames = (departments || []).flatMap((d: { name_en?: string; name_ar?: string }) =>
    [d.name_en, d.name_ar]).filter((n): n is string => !!n)

  if (!products || products.length === 0) {
    return NextResponse.json({
      error: 'No products in catalog. Add products in Tannoor → Products first.',
    }, { status: 400 })
  }

  // Atomic compare-and-set lock — see the twin in the Furn process route. Keyed
  // on status: a live run is status='in_progress', a fresh project is 'pending',
  // a done one is 'completed'/'missing_products', a failed one 'rejected' — all of
  // which the predicate lets through, so only a genuinely running job is blocked.
  // A heartbeat (below) keeps a live run fresh, so the stale window is short and
  // an orphaned lock (crash/deploy) frees in minutes, not half an hour.
  const STALE_LOCK_MS = 5 * 60 * 1000
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const { data: locked } = await supabase.from('tannoor_projects')
    .update({ status: 'in_progress', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .or(`status.neq.in_progress,updated_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()

  if (!locked) {
    return NextResponse.json(
      { error: 'المشروع قيد المعالجة فعلاً الآن — انتظر دقيقة لين تخلص، أو أعد المحاولة.' },
      { status: 409 },
    )
  }

  // Liveness heartbeat: keep updated_at fresh while this (synchronous) run is
  // alive; the interval fires between the awaited Gemini calls. Cleared in the
  // finally so a stray beat can't re-stick a finished lock.
  let alive = true
  const heartbeat = setInterval(() => {
    if (!alive) return
    void supabase.from('tannoor_projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'in_progress')
      .then(() => {}, () => {})
  }, 30_000)

  try {
    const colorStore = await getColors()
    const result = await analyzeTannoorBoq({
      boqUrl: project.boq_url,
      boqFilename: project.boq_filename || 'BOQ',
      specFiles: Array.isArray(project.spec_files) ? project.spec_files : [],
      drawingFiles: Array.isArray(project.drawing_files) ? project.drawing_files : [],
      products: products as TannoorProduct[],
      departments: (departments || []) as FurnDepartment[],
      projectName: project.project_name_en || project.project_name_ar || 'Project',
      companyName: project.company_en || project.company_ar || 'Company',
      productColors: colorStore.byProduct,
      productAttrs: colorStore.attrs,
    })

    // Replace items with the matched output.
    await supabase.from('tannoor_items').delete().eq('project_id', id)

    // Audit sources (where each quantity came from), kept in a local map keyed
    // by the new item ids since tannoor_items has no source column.
    const sourceMap: Record<string, string> = {}

    if (result.items.length > 0) {
      // Join product prices when matched.
      const productMap = new Map(
        (products as TannoorProduct[]).map(p => [p.id, p])
      )
      // Seed prices in the currency the project will actually be quoted in.
      const projectCurrency: 'SAR' | 'USD' = project.pricing_currency === 'USD' ? 'USD' : 'SAR'
      const fx = await getFxSettings()

      // The same deterministic gate Furn runs. Tannoor needs it MORE, not less:
      // Furn has a human pricing step that would catch a concrete line before it
      // reaches a customer — Tannoor auto-prices and auto-completes, so nobody
      // ever looks. Until now this engine had no compound-name rule at all, in
      // its prompt or its code.
      const rejected: Array<{ description: string; reason: string }> = []
      const extraDepartments = new Set<string>()
      const keptItems = result.items.filter((it) => {
        const verdict = guardItem(it.description || '', null, coveredNames)
        if (!verdict.disqualified) return true
        rejected.push({ description: it.description, reason: verdict.reason || '' })
        if (verdict.realDepartment) extraDepartments.add(verdict.realDepartment)
        return false
      })
      if (rejected.length > 0) {
        console.log(`[tannoor] guard dropped ${rejected.length} non-stone item(s) from project ${id}:`)
        for (const r of rejected) console.log(`  • "${r.description}" — ${r.reason}`)
      }
      const rows = keptItems.map((it, idx) => {
        const product = it.product_id ? productMap.get(it.product_id) : null
        return {
          project_id:    id,
          position:      idx + 1,
          description:   it.description,
          quantity:      it.quantity,
          // KEEP THE CUSTOMER'S UNIT. This used to be `product?.unit || it.unit`,
          // so a BOQ line reading "120 m²" matched to a per-metre product silently
          // became "120 m" priced per metre — the quantity was never converted,
          // only the label. AGENTS.md is explicit: never silently convert units.
          unit:          it.unit || product?.unit || '',
          product_id:    it.product_id,
          // Seed the price in the PROJECT'S currency. For USD, honour the FX
          // setting: a rate mode derives the price from SAR (so the drift-prone
          // price_usd column stops mattering), 'manual' uses price_usd as before.
          // (The old bug: this was `price_sar` unconditionally, so USD quotes
          // billed SAR numbers ~3.75× under a USD header.)
          unit_price:    (projectCurrency === 'USD'
            ? usdPrice(fx, product?.price_sar, product?.price_usd)
            : (product?.price_sar ?? null)),
          currency:      projectCurrency,
          // `notes` is the TEAM's column — the AI must never write here (mirrors
          // Furn). The match explanation lives in ai_missing_items for unmatched
          // lines; matched lines leave notes empty so staff can flag rows clean.
          notes:         null,
          is_missing:    it.is_missing,
          ai_confidence: it.ai_confidence,
        }
      })
      const { data: inserted, error: insErr } = await supabase
        .from('tannoor_items').insert(rows).select('id, position')
      if (insErr) throw new Error(`Failed to persist items: ${insErr.message}`)

      // Map each new item id → its audit source (matched by position).
      const sourceByPos = new Map(keptItems.map((it, idx) => [idx + 1, it.source || '']))
      for (const r of inserted || []) {
        const s = sourceByPos.get(r.position as number)
        if (s) sourceMap[r.id as string] = s
      }
    }

    // Replace the project's source map (cleared when there are no items).
    await setProjectItemSources(id, sourceMap)

    // A zero-quantity line is NOT ready to quote — the AI found the row but
    // couldn't resolve how much. Tannoor auto-completes with no human gate, so
    // this must hold the project back exactly like an unmatched product does.
    const hasMissing =
      result.items.some(it => it.is_missing || !(it.quantity > 0)) ||
      (result.missing_items?.length || 0) > 0

    await supabase.from('tannoor_projects').update({
      subject:                 result.subject,
      ai_summary:              result.notes,
      ai_detected_departments: result.detected_departments,
      ai_missing_items:        result.missing_items || [],
      ai_error:                null,
      stage:                   hasMissing ? 'processing' : 'quoted',
      status:                  hasMissing ? 'missing_products' : 'completed',
      updated_at:              new Date().toISOString(),
    }).eq('id', id)

    return NextResponse.json({
      ok: true,
      items_count: result.items.length,
      missing_count: result.items.filter(it => it.is_missing).length,
      detected_departments: result.detected_departments,
      missing_items: result.missing_items,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // status='rejected' also frees the lock — the predicate lets any non
    // in_progress project through, so a retry works immediately.
    await supabase.from('tannoor_projects').update({
      status: 'rejected',
      ai_error: friendlyAiError(msg).slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ error: friendlyAiError(msg) }, { status: 500 })
  } finally {
    alive = false
    clearInterval(heartbeat)
  }
}
