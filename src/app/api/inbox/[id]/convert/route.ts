// POST /api/inbox/[id]/convert — turn a whole email THREAD into a client_project.
//
// A conversation (original + replies) is treated as one unit: we hydrate every
// message in the thread, POOL all their attachments + bodies, and the AI drafts
// one project (name/company/engineer + file buckets) from the pooled content.
// It's inserted through the SAME table the normal create flow uses, so /projects
// and both Furn's + Tannoor's imports treat it identically. Every message in the
// thread is stamped 'converted' with a back-link so the thread leaves the list.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { serverAudit } from '@/lib/audit-server'
import { getEmail, getThreadEmails, updateThread, type InboxEmail, type EmailAttachment } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { buildProjectDraft } from '@/lib/inbox/convert'
import { hydrateEmail } from '@/lib/inbox/imap'

export const runtime = 'nodejs'
export const maxDuration = 300

// Merge a thread's messages into one email-shaped object for the drafter:
// de-duped attachments (replies re-attach originals), concatenated bodies, and
// the union of every message's extracted requirements onto the root's preview.
function poolThread(thread: InboxEmail[]): InboxEmail {
  const root = thread[0]
  const seen = new Set<string>()
  const attachments: EmailAttachment[] = []
  for (const e of thread) {
    for (const a of e.attachments) {
      const k = `${a.name}|${a.bytes}`
      if (seen.has(k)) continue
      seen.add(k)
      attachments.push(a)
    }
  }
  const bodyText = thread
    .map((e, i) => `--- رسالة ${i + 1} (${(e.date || '').slice(0, 10)} — ${e.fromName || e.fromEmail}) ---\n${e.bodyText}`)
    .join('\n\n')
    .slice(0, 8000)
  const requirements = Array.from(new Set(thread.flatMap((e) => e.preview?.requirements || [])))
  const basePreview = root.preview || thread.find((e) => e.preview)?.preview || null
  const preview = basePreview ? { ...basePreview, requirements } : null
  return { ...root, attachments, bodyText, preview }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Creating a project is the projects module's privilege.
  if (!hasPermission(profile, permissions, 'client_projects.create')) {
    return NextResponse.json({ error: 'ما عندك صلاحية إنشاء مشاريع' }, { status: 403 })
  }
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (email.status === 'converted' && email.projectId) {
    return NextResponse.json({ project: { id: email.projectId }, alreadyConverted: true })
  }

  // The whole thread becomes one project. Hydrate every message that hasn't been
  // fetched yet (listed-only ones have no attachments), then pool them.
  let thread = await getThreadEmails(email.threadId)
  if (thread.length === 0) thread = [email]
  for (let i = 0; i < thread.length; i++) {
    if (!thread[i].hydrated) {
      const h = await hydrateEmail(thread[i].id)
      if (h.ok && h.email) thread[i] = h.email
      // A single message failing to hydrate must not sink the convert — its
      // siblings still carry the project's files.
    }
  }

  const draft = await buildProjectDraft(poolThread(thread))

  const { data, error } = await supabase
    .from('client_projects')
    .insert({
      name_ar: draft.name_ar,
      name_en: draft.name_en,
      company_ar: draft.company_ar,
      company_en: draft.company_en,
      engineer_name_ar: draft.engineer_name_ar,
      engineer_name_en: draft.engineer_name_en,
      engineer_phone: draft.engineer_phone,
      notes: draft.notes,
      // Furn's + Tannoor's import cards read {url,name,key,bytes,category} — build them exact.
      files: draft.files,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'client_project',
    objectName: data.name_ar || data.name_en, objectId: data.id,
  })

  await updateThread(email.threadId, { status: 'converted', projectId: data.id })

  return NextResponse.json({ project: data })
}
