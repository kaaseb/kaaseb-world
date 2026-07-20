// PATCH  /api/inbox/[id] — set status (archive) for the WHOLE thread
// DELETE /api/inbox/[id] — drop the whole thread from the inbox (S3 attachments
//                          stay; they may already back a created project)
//
// The inbox presents a conversation as one item, so both actions resolve the
// email's threadId and apply to every message in it.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getEmail, updateThread, deleteThread } from '@/lib/inbox/store'
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
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const changed = await updateThread(email.threadId, { status: body.status })
  return NextResponse.json({ ok: true, changed })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const removed = await deleteThread(email.threadId)
  return NextResponse.json({ ok: true, removed })
}
