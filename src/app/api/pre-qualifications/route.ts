// GET  /api/pre-qualifications — list
// POST /api/pre-qualifications — create (does NOT render — render is a
//                                separate step at /api/pre-qualifications/[id]/render)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('pre_qualifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data || [] })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const ids = Array.isArray(body.document_ids) ? (body.document_ids as string[]) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Pick at least one document' }, { status: 400 })
  }

  const { data, error } = await supabase.from('pre_qualifications').insert({
    company_en:       String(body.company_en       || '').trim() || null,
    company_ar:       String(body.company_ar       || '').trim() || null,
    project_name_en:  String(body.project_name_en  || '').trim() || null,
    project_name_ar:  String(body.project_name_ar  || '').trim() || null,
    document_ids:     ids,
    stamp_mode:       (body.stamp_mode === 'all' || body.stamp_mode === 'none') ? body.stamp_mode : 'last',
    created_by:       user.id,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'pre_qualification',
    objectName: data.company_en || data.company_ar, objectId: data.id,
  })
  return NextResponse.json({ item: data })
}
