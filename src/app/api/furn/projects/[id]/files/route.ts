// POST /api/furn/projects/[id]/files — attach already-uploaded files to an
// EXISTING Furn project's buckets. The files come from /api/upload (browser →
// S3); this route only records them. It is what lets the team open a
// sign-in-gated link, download the real BOQs, and drop them on the project —
// then press "Retry". Logic shared with the link-fetch route (attach-files.ts).
//
// Body: { bucket: 'boq'|'spec'|'drawing'|'other', files: [{ url, name }] }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { isAppOwnedUrl } from '@/lib/s3'
import type { FurnBoqFile } from '@/lib/furn/project-extras'
import { attachFilesToFurnProject, BUCKETS } from '@/lib/furn/attach-files'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const deny = await denyUnlessPermitted('furn.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { bucket?: unknown; files?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const bucket = BUCKETS.find((b) => b === body.bucket)
  if (!bucket) return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })

  // Only files WE stored may be attached — never a foreign URL.
  const incoming: FurnBoqFile[] = []
  for (const f of (Array.isArray(body.files) ? body.files : []) as Array<{ url?: unknown; name?: unknown }>) {
    const url = typeof f?.url === 'string' ? f.url.trim() : ''
    if (!url || !isAppOwnedUrl(url)) continue
    incoming.push({ url, name: String(f?.name || 'file').slice(0, 200) })
  }
  if (incoming.length === 0) return NextResponse.json({ error: 'لا ملفات صالحة' }, { status: 400 })

  const r = await attachFilesToFurnProject(supabase, id, { [bucket]: incoming })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ project: r.project, boqFiles: r.boqFiles, added: r.added[bucket], demoted: r.demoted })
}
