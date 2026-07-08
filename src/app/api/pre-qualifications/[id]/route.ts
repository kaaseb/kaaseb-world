import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { deleteFromS3 } from '@/lib/s3'
import { serverAudit } from '@/lib/audit-server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const ALLOWED = new Set(['company_en','company_ar','project_name_en','project_name_ar','document_ids','stamp_mode'])
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (ALLOWED.has(k)) patch[k] = v
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No allowed fields' }, { status: 400 })

  const { data, error } = await supabase
    .from('pre_qualifications').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'pre_qualification',
    objectName: data.company_en || data.company_ar, objectId: data.id,
  })
  return NextResponse.json({ item: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('pre_qualifications').select('output_pdf_key, company_en, company_ar').eq('id', id).maybeSingle()

  const { error } = await supabase.from('pre_qualifications').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing?.output_pdf_key) {
    try { await deleteFromS3(existing.output_pdf_key) } catch { /* best effort */ }
  }

  await serverAudit({
    user, supabase, action: 'delete', objectType: 'pre_qualification',
    objectName: existing?.company_en || existing?.company_ar || null, objectId: id,
  })
  return NextResponse.json({ ok: true })
}
