// POST /api/furn/projects/[id]/reimport
//
// Re-pull EVERYTHING from the source client project into an existing Furn
// project: every file of every category (all the BOQ workbooks, specs,
// drawings, others), the notes (links included) and the keywords. Files and
// extras are REPLACED with what the client project holds now; the project's
// own text fields are only filled where they are still blank, so a name or
// phone the team corrected on the Furn side is never overwritten.
//
// Items are NOT touched — the team presses "Retry" afterwards to re-read.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { setFurnExtras, type FurnBoqFile } from '@/lib/furn/project-extras'

const BUCKET_CAP = 250
type ClientFile = { url?: unknown; name?: unknown; category?: unknown }
type Bucket = 'boq' | 'spec' | 'drawing' | 'other'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('furn.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project } = await supabase
    .from('furn_projects')
    .select('id, source_client_project_id, project_name, company_name, engineer_name, engineer_phone')
    .eq('id', id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.source_client_project_id) {
    return NextResponse.json({ error: 'هذا المشروع لم يُستورد من مشروع عميل — لا يوجد مصدر يُسحب منه.' }, { status: 400 })
  }

  const { data: cp } = await supabase
    .from('client_projects').select('*').eq('id', project.source_client_project_id).maybeSingle()
  if (!cp) return NextResponse.json({ error: 'مشروع العميل الأصلي غير موجود (ربما حُذف).' }, { status: 404 })

  // Every file of every category, deduplicated by url, capped per bucket.
  const buckets: Record<Bucket, FurnBoqFile[]> = { boq: [], spec: [], drawing: [], other: [] }
  const seen = new Set<string>()
  for (const f of (Array.isArray(cp.files) ? cp.files : []) as ClientFile[]) {
    const url = typeof f.url === 'string' ? f.url.trim() : ''
    if (!url || seen.has(url)) continue
    seen.add(url)
    const cat: Bucket = f.category === 'boq' || f.category === 'spec' || f.category === 'drawing' ? f.category : 'other'
    if (buckets[cat].length < BUCKET_CAP) buckets[cat].push({ url, name: String(f.name || 'file').slice(0, 200) })
  }
  const notes = typeof cp.notes === 'string' ? cp.notes.trim().slice(0, 10_000) : ''
  const keywords = typeof cp.keywords === 'string' ? cp.keywords.trim().slice(0, 1_000) : ''

  const patch: Record<string, unknown> = {
    boq_url: buckets.boq[0]?.url ?? null,
    boq_filename: buckets.boq[0]?.name ?? null,
    spec_files: buckets.spec,
    drawing_files: buckets.drawing,
    other_files: buckets.other,
    updated_at: new Date().toISOString(),
  }
  // Fill blanks only — never overwrite what the team typed on the Furn side.
  if (!project.project_name || project.project_name === 'Untitled project') patch.project_name = cp.name_ar || cp.name_en || project.project_name
  if (!project.company_name || project.company_name === '—') patch.company_name = cp.company_ar || cp.company_en || project.company_name
  if (!project.engineer_name) patch.engineer_name = cp.engineer_name_ar || cp.engineer_name_en || null
  if (!project.engineer_phone) patch.engineer_phone = cp.engineer_phone || null

  const extras = { boqFiles: buckets.boq, notes: notes || null, keywords: keywords || null, importedFrom: cp.id as string }
  try {
    await setFurnExtras(id, extras)
  } catch (e) {
    return NextResponse.json({ error: `فشل حفظ ملفات المشروع الإضافية — ${e instanceof Error ? e.message : 'حاول مرة أخرى'}` }, { status: 500 })
  }
  const { data, error } = await supabase.from('furn_projects').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    project: data,
    extras: { boqFiles: extras.boqFiles, notes: extras.notes, keywords: extras.keywords },
    counts: { boq: buckets.boq.length, spec: buckets.spec.length, drawing: buckets.drawing.length, other: buckets.other.length },
  })
}
