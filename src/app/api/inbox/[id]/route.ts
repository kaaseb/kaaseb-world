// PATCH  /api/inbox/[id] — set status (archive)
// DELETE /api/inbox/[id] — drop an email from the inbox (S3 attachments stay;
//                          they may already back a created project)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { updateEmail, deleteEmail } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'

export const runtime = 'nodejs'

async function guard(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return { error: csrfError }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!(await inboxUnlocked())) return { error: NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 }) }
  return { error: null }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params

  let body: { status?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (body.status !== 'new' && body.status !== 'archived') {
    return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 })
  }
  const item = await updateEmail(id, { status: body.status })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params
  const ok = await deleteEmail(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
