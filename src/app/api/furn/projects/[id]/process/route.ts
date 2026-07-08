// POST /api/furn/projects/[id]/process
//
// Kicks off the AI pipeline:
//   1. Mark project status as in_progress
//   2. Pull covered departments
//   3. Send BOQ + specs + drawings to Gemini for structured extraction
//   4. Wipe & repopulate furn_items with extracted lines
//   5. Persist subject + detected_departments back onto the project
//   6. Advance stage to "pricing"
//
// On error: status=rejected, ai_error stored on project.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { analyzeBoq } from '@/lib/furn/boq'
import { setProjectItemSources } from '@/lib/furn/item-sources'

export const maxDuration = 300 // 5 min — Gemini extractions can be slow on large BOQs

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project, error: pErr } = await supabase
    .from('furn_projects').select('*').eq('id', id).single()
  if (pErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.boq_url) return NextResponse.json({ error: 'No BOQ uploaded' }, { status: 400 })

  // Pull only enabled departments. The AI uses these as the allow-list.
  const { data: depts } = await supabase
    .from('furn_departments').select('name_en, name_ar').eq('enabled', true)

  const coveredDepartments = (depts || []).map(d => ({
    name_en: d.name_en as string,
    name_ar: d.name_ar as string,
  }))

  if (coveredDepartments.length === 0) {
    return NextResponse.json({
      error: 'No covered departments enabled. Add and enable departments in Furn Settings first.',
    }, { status: 400 })
  }

  await supabase.from('furn_projects')
    .update({ status: 'in_progress', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)

  try {
    const result = await analyzeBoq({
      boqUrl: project.boq_url,
      boqFilename: project.boq_filename || 'BOQ',
      specFiles: Array.isArray(project.spec_files) ? project.spec_files : [],
      drawingFiles: Array.isArray(project.drawing_files) ? project.drawing_files : [],
      coveredDepartments,
      projectName: project.project_name,
      companyName: project.company_name,
    })

    // Replace items: delete the old set, insert the new one. Avoids stale rows
    // from a previous extraction sticking around if the user re-runs.
    await supabase.from('furn_items').delete().eq('project_id', id)

    // Audit sources kept in a separate S3 map (keyed by new item id) so they
    // stay out of the editable `details` field and the customer PDF.
    const sourceMap: Record<string, string> = {}

    if (result.items.length > 0) {
      // `details` holds ONLY the AI's descriptive line (finish/thickness/dims).
      // `notes` stays NULL for the team. The source lives in the S3 map.
      const rows = result.items.map((it, idx) => ({
        project_id: id,
        position: idx + 1,
        description: it.description,
        details: it.details,
        quantity: it.quantity,
        unit: it.unit,
        notes: null,
        ai_confidence: it.ai_confidence,
        unit_price: null,
      }))
      const { data: inserted, error: insErr } = await supabase
        .from('furn_items').insert(rows).select('id, position')
      if (insErr) throw new Error(`Failed to persist items: ${insErr.message}`)

      const sourceByPos = new Map(result.items.map((it, idx) => [idx + 1, it.source || '']))
      for (const r of inserted || []) {
        const s = sourceByPos.get(r.position as number)
        if (s) sourceMap[r.id as string] = s
      }
    }

    // Replace the project's source map (cleared when there are no items).
    await setProjectItemSources(id, sourceMap)

    await supabase.from('furn_projects').update({
      subject: result.subject,
      ai_summary: result.notes,
      ai_detected_departments: result.detected_departments,
      ai_error: null,
      stage: 'pricing',
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    return NextResponse.json({
      ok: true,
      subject: result.subject,
      items_count: result.items.length,
      detected_departments: result.detected_departments,
      notes: result.notes,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('furn_projects').update({
      status: 'rejected',
      ai_error: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
