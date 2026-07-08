// GET  /api/important-documents — list
// POST /api/important-documents — create

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('important_documents')
    .select('*')
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data || [] })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!body.file_url) return NextResponse.json({ error: 'file_url is required' }, { status: 400 })
  const nameEn = String(body.name_en || '').trim()
  const nameAr = String(body.name_ar || '').trim()
  if (!nameEn && !nameAr) {
    return NextResponse.json({ error: 'Document name is required' }, { status: 400 })
  }

  const { data, error } = await supabase.from('important_documents').insert({
    name_en: nameEn || null,
    name_ar: nameAr || null,
    file_url: String(body.file_url),
    file_name: body.file_name ? String(body.file_name) : null,
    file_key: body.file_key  ? String(body.file_key)  : null,
    expiry_date: body.expiry_date || null,
    notes: String(body.notes || '').trim() || null,
    created_by: user.id,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'important_document',
    objectName: data.name_en || data.name_ar, objectId: data.id,
  })
  return NextResponse.json({ document: data })
}
