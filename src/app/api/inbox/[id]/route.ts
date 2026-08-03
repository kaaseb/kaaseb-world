// GET    /api/inbox/[id] — one email with its FULL body (html/links/text) for the reader
// PATCH  /api/inbox/[id] — { status } archive the thread · { read:true } mark read
//                          · { preview } save the team's edits to the extracted info
// DELETE /api/inbox/[id] — remove the thread AND move its messages to Trash on Titan
//
// The inbox presents a conversation as one item, so status/read/delete apply to
// every message in the thread.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import {
  getEmail, getThreadEmails, updateThread, deleteThread,
  markThreadRead, updateEmailPreview, type EmailPreview,
} from '@/lib/inbox/store'
import { trashEmails } from '@/lib/inbox/imap'
import { inboxUnlocked } from '@/lib/inbox/lock'

export const runtime = 'nodejs'
export const maxDuration = 60

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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // GET has no side effects, so it doesn't need the CSRF origin check — but still
  // gate on auth + the inbox permission + the PIN.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ email })
}

function cleanPreview(raw: unknown): EmailPreview | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x || '').slice(0, 400)).filter(Boolean).slice(0, 40) : [])
  return {
    projectName: String(p.projectName || '').slice(0, 300),
    summary: String(p.summary || '').slice(0, 4000),
    highlights: arr(p.highlights),
    requirements: arr(p.requirements),
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params

  let body: { status?: unknown; read?: unknown; preview?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.read === true) {
    await markThreadRead(email.threadId)
  }
  if (body.preview !== undefined) {
    const preview = cleanPreview(body.preview)
    if (preview) await updateEmailPreview(id, preview)
  }
  if (body.status !== undefined) {
    if (body.status !== 'new' && body.status !== 'archived') {
      return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 })
    }
    await updateThread(email.threadId, { status: body.status })
  }

  const updated = await getEmail(id)
  return NextResponse.json({ ok: true, email: updated })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Move the whole thread's messages to Trash on Titan first (best-effort), so the
  // deletion is real on the server and the next sync won't re-add them. A failure
  // here doesn't block the local removal.
  const thread = await getThreadEmails(email.threadId)
  const msgs = (thread.length ? thread : [email]).map((e) => ({
    folder: e.folder, uid: e.uid, uidValidity: e.uidValidity, id: e.id,
  }))
  let trashError: string | null = null
  try {
    const r = await trashEmails(msgs)
    trashError = r.error
  } catch (e) {
    trashError = e instanceof Error ? e.message : 'فشل النقل لسلة المحذوفات'
  }

  const removed = await deleteThread(email.threadId)
  return NextResponse.json({ ok: true, removed, trashError })
}
