// GET   /api/furn/projects/[id]/names — the project's names in both languages.
// PATCH /api/furn/projects/[id]/names — edit them (and the engineer's phone)
//                                        before the quotation is issued.
//
// The Arabic/English pair lives in the S3 extras store; the row keeps a single
// value per field (Arabic when given, else English) for lists and search.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getFurnExtras, setFurnExtras, type ProjectNames } from '@/lib/furn/project-extras'
import { resolveProjectNames } from '@/lib/furn/names'

const clip = (v: unknown, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const deny = await denyUnlessPermitted('page.furn')
  if (deny) return deny
  const { id } = await params
  const supabase = await createClient()
  const { data: project } = await supabase
    .from('furn_projects')
    .select('project_name, company_name, engineer_name, engineer_phone, source_client_project_id')
    .eq('id', id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const names = await resolveProjectNames(supabase, project, await getFurnExtras(id))
  return NextResponse.json({ names, engineer_phone: project.engineer_phone || '' })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const deny = await denyUnlessPermitted('furn.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const names: ProjectNames = {
    project_ar: clip(body.project_ar), project_en: clip(body.project_en),
    company_ar: clip(body.company_ar), company_en: clip(body.company_en),
    engineer_ar: clip(body.engineer_ar), engineer_en: clip(body.engineer_en),
  }
  if (!names.project_ar && !names.project_en) return NextResponse.json({ error: 'اسم المشروع مطلوب (بإحدى اللغتين على الأقل)' }, { status: 400 })

  const { data: exists } = await supabase.from('furn_projects').select('id').eq('id', id).maybeSingle()
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await setFurnExtras(id, { names })
  } catch (e) {
    return NextResponse.json({ error: `فشل الحفظ — ${e instanceof Error ? e.message : 'حاول مرة أخرى'}` }, { status: 500 })
  }
  const { data: project, error } = await supabase.from('furn_projects').update({
    project_name: names.project_ar || names.project_en,
    company_name: names.company_ar || names.company_en || '—',
    engineer_name: names.engineer_ar || names.engineer_en || null,
    engineer_phone: clip(body.engineer_phone, 40) || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ project, names: await resolveProjectNames(supabase, project, { names }) })
}
