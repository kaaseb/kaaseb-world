// GET    /api/furn/projects/[id]  — fetch project + items
// PATCH  /api/furn/projects/[id]  — update project fields (stage, status, terms…)
// DELETE /api/furn/projects/[id]  — remove project + items + quotations

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

const ALLOWED_PATCH_KEYS = new Set([
  'project_name', 'company_name', 'engineer_name', 'commercial_register', 'tax_number',
  'subject', 'payment_terms', 'delivery_terms', 'offer_duration', 'special_conditions',
  'stage', 'status',
])

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: project, error: pErr }, { data: items, error: iErr }, { data: quotations }] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
    supabase.from('furn_quotations').select('*').eq('project_id', id).order('generated_at', { ascending: false }),
  ])

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

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
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_PATCH_KEYS.has(k)) patch[k] = v
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No allowed fields in patch' }, { status: 400 })
  }
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('furn_projects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('furn_projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
