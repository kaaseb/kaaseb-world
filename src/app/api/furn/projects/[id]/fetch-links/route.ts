// POST /api/furn/projects/[id]/fetch-links — pull the files behind a share
// link (WeTransfer / Drive / Dropbox / OneDrive / SharePoint / GoFile / direct)
// straight onto an EXISTING Furn project: archives are opened, every file
// lands in the right bucket by name (Excel → BOQ, PDF → specs, DWG/images →
// drawings), the email-body placeholder is demoted once real BOQs arrive.
//
// Body: { url }  →  { status, provider, message?, files, added, demoted, notices, project, boqFiles }
// A link that needs a person (sign-in / password / expired) returns 200 with
// `status` and a human message — the UI shows it under the link.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { serverAudit } from '@/lib/audit-server'
import { ingestLink } from '@/lib/links/ingest'
import { attachFilesToFurnProject, groupByName } from '@/lib/furn/attach-files'
import { recordLinkFetch } from '@/lib/furn/project-extras'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const deny = await denyUnlessPermitted('furn.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!/^https?:\/\//i.test(url) || url.length > 2048) return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 })

  const { data: exists } = await supabase.from('furn_projects').select('id').eq('id', id).maybeSingle()
  if (!exists) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const ing = await ingestLink({ url, kind: 'furn', userId: user.id, folder: id })
  const at = new Date().toISOString()
  if (ing.status !== 'files') {
    // Remember the refusal too: after navigating away the card still says why.
    const linkFetches = await recordLinkFetch(id, url, { at, status: ing.status, provider: ing.provider, files: 0, message: ing.message }).catch(() => undefined)
    return NextResponse.json({ status: ing.status, provider: ing.provider, message: ing.message, files: [], notices: ing.notices, linkFetches })
  }

  const groups = groupByName(ing.files.map((f) => ({ url: f.url, name: f.name })))
  const r = await attachFilesToFurnProject(supabase, id, groups)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const linkFetches = await recordLinkFetch(id, url, { at, status: 'files', provider: ing.provider, files: ing.files.length }).catch(() => undefined)

  await serverAudit({ user, supabase, action: 'edit', objectType: 'furn_project', objectId: id, objectName: `جلب ${ing.files.length} ملف من رابط ${ing.provider}` })

  return NextResponse.json({
    status: 'files', provider: ing.provider, files: ing.files, notices: ing.notices,
    added: r.added, demoted: r.demoted, project: r.project, boqFiles: r.boqFiles, linkFetches,
  })
}
