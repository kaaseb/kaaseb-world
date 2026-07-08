// GET    /api/client-projects/[id] — fetch
// PATCH  /api/client-projects/[id] — partial update (fields + files)
// DELETE /api/client-projects/[id]

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'

// Status (and stage) can be touched by anyone who can see the project, so the
// outer table can be used as a quick "drag to next column". Every other field
// requires `client_projects.edit`; deletion requires `client_projects.delete`.
const STATUS_FIELDS = new Set(['status', 'stage'])
const ALLOWED = new Set([
  'name_en', 'name_ar',
  'company_en', 'company_ar',
  'engineer_name_en', 'engineer_name_ar',
  'engineer_phone',
  'end_date',
  'pricing_currency',
  'status', 'stage',
  'keywords',
  'notes',
  'files',
  'responsible_user_id',
])

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('client_projects')
    .select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)')
    .eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ project: data })
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
    if (!ALLOWED.has(k)) continue
    if (k === 'pricing_currency') {
      const c = String(v ?? '').toUpperCase()
      patch[k] = c === 'USD' ? 'USD' : 'SAR'
    } else if (k === 'responsible_user_id') {
      // Empty string from the dropdown's "no owner" option becomes NULL.
      patch[k] = typeof v === 'string' && v.length > 0 ? v : null
    } else {
      patch[k] = v
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No allowed fields' }, { status: 400 })
  }

  // Permission gate: status/stage flips are open to any authenticated user
  // (so the table inline dropdown works for employees). Anything else
  // requires the edit permission.
  const touchesNonStatus = Object.keys(patch).some(k => !STATUS_FIELDS.has(k))
  if (touchesNonStatus) {
    const profile = await getProfileOrFallback(supabase, user)
    const permissions = await getEffectivePermissions(supabase, profile)
    if (!hasPermission(profile, permissions, 'client_projects.edit')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('client_projects').update(patch).eq('id', id)
    .select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'client_project',
    objectName: data.name_en || data.name_ar, objectId: data.id,
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

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'client_projects.delete')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Grab the name first so the audit row carries something human-readable.
  const { data: existing } = await supabase
    .from('client_projects').select('name_en, name_ar').eq('id', id).maybeSingle()

  const { error } = await supabase.from('client_projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'delete', objectType: 'client_project',
    objectName: existing?.name_en || existing?.name_ar || null, objectId: id,
  })
  return NextResponse.json({ ok: true })
}
