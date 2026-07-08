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

  if (!products || products.length === 0) {
    return NextResponse.json({
      error: 'No products in catalog. Add products in Tannoor → Products first.',
    }, { status: 400 })
  }

  await supabase.from('tannoor_projects')
    .update({ status: 'in_progress', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)

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
      const rows = result.items.map((it, idx) => {
        const product = it.product_id ? productMap.get(it.product_id) : null
        return {
          project_id:    id,
          position:      idx + 1,
          description:   it.description,
          quantity:      it.quantity,
          unit:          product?.unit || it.unit,
          product_id:    it.product_id,
          unit_price:    product?.price_sar ?? null,
          currency:      'SAR' as const,
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
      const sourceByPos = new Map(result.items.map((it, idx) => [idx + 1, it.source || '']))
      for (const r of inserted || []) {
        const s = sourceByPos.get(r.position as number)
        if (s) sourceMap[r.id as string] = s
      }
    }

    // Replace the project's source map (cleared when there are no items).
    await setProjectItemSources(id, sourceMap)

    const hasMissing = result.items.some(it => it.is_missing) || (result.missing_items?.length || 0) > 0

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
    await supabase.from('tannoor_projects').update({
      status: 'rejected',
      ai_error: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
