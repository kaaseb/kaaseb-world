import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

const ALLOWED = new Set([
  'project_name_en','project_name_ar','company_en','company_ar',
  'engineer_name_en','engineer_name_ar','engineer_phone',
  'commercial_register','tax_number','subject',
  'payment_terms','delivery_terms','offer_duration','special_conditions',
  'stage','status',
])

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: project }, { data: items }, { data: quotations }] = await Promise.all([
    supabase.from('tannoor_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('tannoor_items').select('*, tannoor_products(id, name_en, name_ar, unit, price_sar, price_usd, availability)').eq('project_id', id).order('position'),
    supabase.from('tannoor_quotations').select('*').eq('project_id', id).order('generated_at', { ascending: false }),
  ])
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ project, items: items || [], quotations: quotations || [] })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (ALLOWED.has(k)) patch[k] = v
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  const { data, error } = await supabase
    .from('tannoor_projects').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'tannoor_project',
    objectName: data.project_name_en || data.project_name_ar, objectId: data.id,
  })
  return NextResponse.json({ project: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('tannoor_projects').select('project_name_en, project_name_ar').eq('id', id).maybeSingle()

  const { error } = await supabase.from('tannoor_projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'delete', objectType: 'tannoor_project',
    objectName: existing?.project_name_en || existing?.project_name_ar || null, objectId: id,
  })
  return NextResponse.json({ ok: true })
}
