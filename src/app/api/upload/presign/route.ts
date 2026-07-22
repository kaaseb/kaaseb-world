// POST /api/upload/presign — hand the browser a short-lived signed URL so it can
// PUT the file STRAIGHT TO S3.
//
// WHY THIS EXISTS: the normal /api/upload posts the whole file through nginx to
// Node, so nginx's client_max_body_size answers 413 for anything big (a company
// profile, a 200-page drawing set) before the app ever sees it. Here only a few
// hundred bytes of JSON cross the proxy — the file itself goes browser → AWS —
// so there is no size ceiling to raise and no server memory spent.
//
// Security: the same KIND_POLICY the classic route enforces is applied BEFORE
// signing (kind must exist, MIME must be allowed, super-admin kinds checked).
// The signature pins bucket + key + content-type and expires in 15 minutes, so
// it cannot be replayed to write anywhere else in the bucket.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { presignUpload } from '@/lib/s3'
import { policyFor, mimeAllowed } from '@/lib/upload-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { kind?: unknown; filename?: unknown; contentType?: unknown; folder?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'projects'
  const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'file'
  const contentType = typeof body.contentType === 'string' ? body.contentType : ''

  const policy = policyFor(kind)
  if (!policy) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  if (!mimeAllowed(policy, contentType)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }
  if (policy.superAdminOnly) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Same sanitising as the classic route: no slashes, short.
  const rawFolder = typeof body.folder === 'string' ? body.folder.trim() : ''
  const folder = rawFolder ? rawFolder.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || undefined : undefined

  try {
    const signed = await presignUpload({
      userId: user.id,
      kind,
      filename,
      contentType: contentType || 'application/octet-stream',
      folder,
    })
    return NextResponse.json(signed)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'تعذّر تجهيز الرفع' }, { status: 500 })
  }
}
