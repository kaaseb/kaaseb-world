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

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn') && !hasPermission(profile, permissions, 'page.client_projects')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { url?: unknown; kind?: unknown; folder?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!/^https?:\/\//i.test(rawUrl) || rawUrl.length > 2048) return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 })
  const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'projects'
  if (!policyFor(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
  const folder = typeof body.folder === 'string' ? body.folder : undefined

  const r = await ingestLink({ url: rawUrl, kind, userId: user.id, folder })
  if (r.status !== 'files') {
    const status = r.status === 'needsLogin' || r.status === 'password' ? 403 : r.status === 'notFound' || r.status === 'expired' ? 404 : 415
    return NextResponse.json({ error: r.message || 'تعذّر جلب الملف', status: r.status, provider: r.provider, notices: r.notices }, { status })
  }
  const first = r.files[0]
  return NextResponse.json({ url: first.url, key: first.key, bytes: first.bytes, name: first.name, files: r.files, notices: r.notices, status: 'files', provider: r.provider })
}
