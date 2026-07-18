// POST /api/inbox/[id]/convert — turn a pulled email into a client_project.
//
// The AI drafts the project (name/company/engineer + file buckets), then we
// insert a client_project through the SAME table the normal create flow uses,
// so /projects and Furn's import treat it identically. The email is stamped
// 'converted' with a back-link so it leaves the working list.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { serverAudit } from '@/lib/audit-server'
import { getEmail, updateEmail } from '@/lib/inbox/store'
import { buildProjectDraft } from '@/lib/inbox/convert'
import { hydrateEmail } from '@/lib/inbox/imap'

export const runtime = 'nodejs'
export const maxDuration = 120

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

  const { id } = await params
  let email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (email.status === 'converted' && email.projectId) {
    return NextResponse.json({ project: { id: email.projectId }, alreadyConverted: true })
  }

  // A listed-only email has no attachments yet — download them (and the summary)
  // now so the project is built with its files. Normally the owner hydrates from
  // the inbox first; this is the safety net if convert is hit on a raw envelope.
  if (!email.hydrated) {
    const h = await hydrateEmail(id)
    if (!h.ok || !h.email) {
      return NextResponse.json({ error: h.error || 'تعذّر إحضار مرفقات الرسالة.' }, { status: 502 })
    }
    email = h.email
  }

  const draft = await buildProjectDraft(email)

  const { data, error } = await supabase
    .from('client_projects')
    .insert({
      name_ar: draft.name_ar,
      company_ar: draft.company_ar,
      engineer_name_ar: draft.engineer_name_ar,
      engineer_phone: draft.engineer_phone,
      notes: draft.notes,
      // Furn's import card reads {url,name,key,bytes,category} — build them exact.
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

  await updateEmail(id, { status: 'converted', projectId: data.id })

  return NextResponse.json({ project: data })
}
