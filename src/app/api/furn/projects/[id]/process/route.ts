// POST /api/furn/projects/[id]/process
//
// Kicks off the ROUTER pipeline (see src/lib/boq/router/*):
//   1. Claim the project with an atomic lock, return 202 immediately.
//   2. In the background: read the BOQ alone → index the ~200 attachments
//      (content-hash cached) → route every row → read ONLY the routed pages
//      (text = quote-verified, scans = double-read vision) → assemble.
//   3. Guard + wipe & repopulate furn_items, persist subject/departments.
//   4. Advance stage to "pricing"; on error status=rejected + ai_error.
//
// WHY 202 + BACKGROUND: indexing a real 200-file project takes minutes — far
// past any HTTP timeout. This deployment is a long-lived Node process on a VM
// (same reason the visualize renders can be fire-and-forget), and the client
// polls the project + the progress endpoint. Progress lives in S3 at
// app-data/furn-runs/<id>.json so coverage is reported honestly.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { setProjectItemSources } from '@/lib/furn/item-sources'
import { guardItem } from '@/lib/boq/department-guard'
import { runBoqRouter, type RouterInput, type RouterResult } from '@/lib/boq/router/pipeline'

export const maxDuration = 300

interface FurnProjectRow {
  id: string
  boq_url: string | null
  boq_filename: string | null
  spec_files: unknown
  drawing_files: unknown
  other_files: unknown
  project_name: string
  company_name: string
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Gate on the Furn page permission. A router run issues hundreds of billable
  // model calls; it must not be triggerable by any signed-in user (e.g. an
  // inbox-only role). The rest of the Furn API is UI-gated only — this is the
  // one route where the cost makes an explicit server-side check worth it.
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // ── LOCK ──────────────────────────────────────────────────────────────────
  // Atomic compare-and-set: claim the project only if a router run isn't already
  // in flight (or its lock went stale after a crash/deploy). Two tabs cannot
  // both win — without this, interleaved delete+insert doubles every item.
  //
  // We key the lock on STAGE, not status. A finished project sits at
  // stage='pricing'/'quoted' with status='in_progress' (that status means "being
  // priced by humans"), so keying on status would (a) 409 every re-process for
  // 45 min and (b) — worse — the poller keys on stage==='processing' to detect
  // "done", and a claim that left stage untouched made re-processing a quoted
  // project report "done" instantly and then swap its items out underneath the
  // user. Setting stage='processing' here fixes both: the poller sees a real
  // running state, and the lock predicate distinguishes an active run from a
  // priced project.
  const STALE_LOCK_MS = 60 * 60 * 1000 // comfortably longer than the true worst-case run
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const { data: locked } = await supabase.from('furn_projects')
    .update({ stage: 'processing', status: 'in_progress', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .or(`stage.neq.processing,updated_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()

  if (!locked) {
    return NextResponse.json(
      { error: 'المشروع قيد المعالجة بالفعل — انتظر لين تخلص التشغيلة الحالية.' },
      { status: 409 },
    )
  }

  const input: RouterInput = {
    projectId: id,
    boqUrl: project.boq_url,
    boqFilename: project.boq_filename || 'BOQ',
    specFiles: Array.isArray(project.spec_files) ? project.spec_files : [],
    drawingFiles: Array.isArray(project.drawing_files) ? project.drawing_files : [],
    otherFiles: Array.isArray(project.other_files) ? project.other_files : [],
    coveredDepartments,
    projectName: project.project_name,
    companyName: project.company_name,
  }

  // Fire-and-forget — the Node server keeps the promise alive after the
  // response returns (VM deployment, PM2). The client polls.
  void runProcessJob(supabase, project as FurnProjectRow, input, coveredDepartments).catch(() => {})

  return NextResponse.json({ started: true }, { status: 202 })
}

// ─── the background job ─────────────────────────────────────────────────────

async function runProcessJob(
  supabase: SupabaseClient,
  project: FurnProjectRow,
  input: RouterInput,
  coveredDepartments: { name_en: string; name_ar: string }[],
): Promise<void> {
  const id = project.id
  try {
    const result: RouterResult = await runBoqRouter(input)

    // ONLY NOW touch the items table — the risky work is done, so a mid-run
    // failure can no longer leave the project stripped of its previous items.
    await supabase.from('furn_items').delete().eq('project_id', id)

    // Audit sources kept in a separate S3 map (keyed by new item id) so they
    // stay out of the editable `details` field and the customer PDF.
    const sourceMap: Record<string, string> = {}

    // LAST LINE OF DEFENCE before a manufactured look-alike reaches the pricing
    // table and then a customer PDF as stone. The prompt already forbids these
    // and the model answers `department_match` — but a prompt rule can drift;
    // this gate is deterministic and cannot be talked out of it.
    const coveredNames = coveredDepartments.flatMap((d) => [d.name_en, d.name_ar]).filter(Boolean)
    const rejected: Array<{ description: string; reason: string }> = []
    const extraDepartments = new Set<string>()

    const keptItems = result.items.filter((it) => {
      const verdict = guardItem(
        `${it.description || ''} ${it.details || ''}`,
        it.department_match,
        coveredNames,
      )
      if (!verdict.disqualified) return true
      rejected.push({ description: it.description, reason: verdict.reason || '' })
      if (verdict.realDepartment) extraDepartments.add(verdict.realDepartment)
      return false
    })
    if (rejected.length > 0) {
      console.log(`[furn] guard dropped ${rejected.length} non-stone item(s) from project ${id}:`)
      for (const r of rejected) console.log(`  • "${r.description}" — ${r.reason}`)
    }

    // Case-insensitive union — never emit both "Marble" and "marble".
    const departmentsOut = Array.from(
      new Map(
        [...result.detected_departments, ...extraDepartments]
          .map((d) => (d || '').trim())
          .filter(Boolean)
          .map((d) => [d.toLowerCase(), d]),
      ).values(),
    )

    if (keptItems.length > 0) {
      const rows = keptItems.map((it, idx) => ({
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

      const sourceByPos = new Map(keptItems.map((it, idx) => [idx + 1, it.source || '']))
      for (const r of inserted || []) {
        const s = sourceByPos.get(r.position as number)
        if (s) sourceMap[r.id as string] = s
      }
    }

    await setProjectItemSources(id, sourceMap)

    await supabase.from('furn_projects').update({
      subject: result.subject,
      ai_summary: result.notes,
      ai_detected_departments: departmentsOut,
      ai_error: null,
      stage: 'pricing',
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    console.log(
      `[furn] router done for ${id}: ${keptItems.length} items, ` +
      `${result.coverage.rowsResolved} resolved, ${result.coverage.rowsConflict} conflicts, ` +
      `${result.coverage.pagesRead} pages read (${result.coverage.visualReads} visual), ` +
      `index ${result.coverage.filesIndexed}/${result.coverage.filesTotal} (cache ${result.coverage.filesFromCache})`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[furn] router FAILED for ${id}: ${msg}`)
    await supabase.from('furn_projects').update({
      status: 'rejected',
      ai_error: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  }
}
