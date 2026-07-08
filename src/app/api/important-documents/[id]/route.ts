// PATCH /api/important-documents/[id] — partial update
// DELETE /api/important-documents/[id] — delete row + S3 object

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { deleteFromS3 } from '@/lib/s3'
import { serverAudit } from '@/lib/audit-server'

const ALLOWED = new Set(['name_en', 'name_ar', 'expiry_date', 'notes', 'file_url', 'file_name', 'file_key'])

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
    if (ALLOWED.has(k)) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No allowed fields' }, { status: 400 })

  const { data, error } = await supabase
    .from('important_documents').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'important_document',
    objectName: data.name_en || data.name_ar, objectId: data.id,
  })
  return NextResponse.json({ document: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Grab the S3 key + name first so we can clean up the object after the
  // row delete and have something readable for the audit log.
  const { data: existing } = await supabase
    .from('important_documents').select('file_key, name_en, name_ar').eq('id', id).maybeSingle()

  const { error } = await supabase.from('important_documents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing?.file_key) {
    try { await deleteFromS3(existing.file_key) } catch { /* best effort */ }
  }
  await serverAudit({
    user, supabase, action: 'delete', objectType: 'important_document',
    objectName: existing?.name_en || existing?.name_ar || null, objectId: id,
  })
  return NextResponse.json({ ok: true })
}
