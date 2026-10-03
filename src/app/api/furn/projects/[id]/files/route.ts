// /api/furn/projects/[id]/files
//
// POST  — attach already-uploaded files to an EXISTING Furn project's buckets.
//         The files come from /api/upload (browser → S3); this route records
//         them. An uploaded ARCHIVE (ZIP / RAR) is opened here and every member
//         becomes its own file in the right bucket — so the team sees each file
//         on its own and decides what to work on.
//         Body: { bucket: 'boq'|'spec'|'drawing'|'other', files: [{ url, name }] }
//
// PATCH — switch files ON/OFF for processing. A switched-off file stays on the
//         project; the next run simply does not read it.
//         Body: { urls: string[], include: boolean }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { isAppOwnedUrl, fetchAppOwned } from '@/lib/s3'
import { setFilesIncluded, type FurnBoqFile } from '@/lib/furn/project-extras'
import { attachFilesToFurnProject, groupByName, BUCKETS, type Bucket } from '@/lib/furn/attach-files'
import { expandStoredArchive } from '@/lib/links/ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024
const looksLikeArchive = (name: string) => /\.(zip|rar)$/i.test(name || '')

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

  // Archives → their members, each filed by name. Everything else goes to the
  // bucket the user picked.
  const groups: Record<Bucket, FurnBoqFile[]> = { boq: [], spec: [], drawing: [], other: [] }
  const notices: string[] = []
  let expanded = 0
  for (const f of incoming) {
    if (!looksLikeArchive(f.name)) { groups[bucket].push(f); continue }
    try {
      const res = await fetchAppOwned(f.url)
      const len = Number(res.headers.get('content-length') || 0)
      if (!res.ok || len > MAX_ARCHIVE_BYTES) throw new Error(len > MAX_ARCHIVE_BYTES ? `الأرشيف أكبر من ${Math.round(MAX_ARCHIVE_BYTES / 1048576)}MB` : `HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const out = await expandStoredArchive({ name: f.name, buf, kind: 'furn', userId: user.id, folder: id })
      if (!out || out.files.length === 0) {
        // Not an archive after all, or nothing usable inside: keep the file itself.
        if (out) notices.push(...out.notices)
        groups[bucket].push(f)
        continue
      }
      notices.push(...out.notices)
      expanded += out.files.length
      const g = groupByName(out.files.map((x) => ({ url: x.url, name: x.name })))
      for (const b of BUCKETS) groups[b].push(...g[b])
    } catch (e) {
      notices.push(`«${f.name}»: تعذّر فتح الأرشيف (${e instanceof Error ? e.message : 'خطأ'}) — أُضيف كما هو`)
      groups[bucket].push(f)
    }
  }

  const r = await attachFilesToFurnProject(supabase, id, groups)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const added = BUCKETS.reduce((n, b) => n + r.added[b], 0)
  return NextResponse.json({ project: r.project, boqFiles: r.boqFiles, added, addedByBucket: r.added, expanded, demoted: r.demoted, notices })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const deny = await denyUnlessPermitted('furn.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  let body: { urls?: unknown; include?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const urls = (Array.isArray(body.urls) ? body.urls : []).filter((u): u is string => typeof u === 'string' && !!u).slice(0, 1000)
  if (urls.length === 0 || typeof body.include !== 'boolean') return NextResponse.json({ error: 'urls + include required' }, { status: 400 })

  const { data: exists } = await supabase.from('furn_projects').select('id').eq('id', id).maybeSingle()
  if (!exists) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const excluded = await setFilesIncluded(id, urls, body.include)
    return NextResponse.json({ excluded })
  } catch (e) {
    return NextResponse.json({ error: `فشل الحفظ — ${e instanceof Error ? e.message : 'حاول مرة أخرى'}` }, { status: 500 })
  }
}
