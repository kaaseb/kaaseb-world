// PATCH  /api/furn/departments/[id]  — toggle enabled / rename
// DELETE /api/furn/departments/[id]  — drop (default departments are protected)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { name_en?: string; name_ar?: string; enabled?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (typeof body.name_en === 'string') patch.name_en = body.name_en.trim()
  if (typeof body.name_ar === 'string') patch.name_ar = body.name_ar.trim()
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No changes' }, { status: 400 })

  const { data, error } = await supabase
    .from('furn_departments').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ department: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dept } = await supabase
    .from('furn_departments').select('is_default').eq('id', id).maybeSingle()
  if (dept?.is_default) {
    return NextResponse.json({ error: 'Default departments can\'t be deleted (toggle them off instead).' }, { status: 400 })
  }

  const { error } = await supabase.from('furn_departments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
