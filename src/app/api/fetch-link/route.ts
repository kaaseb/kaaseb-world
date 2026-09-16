// POST /api/fetch-link — pull the file(s) behind a share link into S3 and
// return them in the upload flow's shape so a form can drop them into buckets.
//
// The heavy lifting lives in src/lib/links: SSRF-pinned fetching, per-platform
// resolvers (WeTransfer, Google Drive file/folder, Dropbox, OneDrive,
// SharePoint-when-public, GoFile, MediaFire, direct URLs) and in-memory
// ZIP/RAR extraction. A link that needs a person (sign-in / password /
// expired) answers with a clear `status` + message instead of a bare error.
//
// Response: { url, key, bytes, name }  (first file — older callers)
//         + { files: [...all], notices: [...], status, provider, message? }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { policyFor } from '@/lib/upload-policy'
import { ingestLink } from '@/lib/links/ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetching an arbitrary URL server-side and writing the bytes into our bucket
  // is a WRITE capability, not a reading one — `page.furn` is the module's READ
  // key, so a read-only account used to be able to do all of this.
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  const canFurn = hasPermission(profile, permissions, 'furn.projects.create')
  const canProjects = hasPermission(profile, permissions, 'client_projects.create')
    || hasPermission(profile, permissions, 'client_projects.edit')
  if (!canFurn && !canProjects) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { url?: unknown; kind?: unknown; folder?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!/^https?:\/\//i.test(rawUrl) || rawUrl.length > 2048) return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 })
  const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'projects'
  const policy = policyFor(kind)
  if (!policy) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  // Super-admin-only destinations (branding, the outreach profile) are gated on
  // the upload routes; this path writes to the same namespaces.
  if (policy.superAdminOnly && profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const folder = typeof body.folder === 'string' ? body.folder : undefined

  const r = await ingestLink({ url: rawUrl, kind, userId: user.id, folder })
  if (r.status !== 'files') {
    const status = r.status === 'needsLogin' || r.status === 'password' ? 403 : r.status === 'notFound' || r.status === 'expired' ? 404 : 415
    return NextResponse.json({ error: r.message || 'تعذّر جلب الملف', status: r.status, provider: r.provider, notices: r.notices }, { status })
  }
  const first = r.files[0]
  return NextResponse.json({ url: first.url, key: first.key, bytes: first.bytes, name: first.name, files: r.files, notices: r.notices, status: 'files', provider: r.provider })
}
