// Unified upload endpoint. All Kaaseb media now lives in a single AWS S3
// bucket; `kind` controls what's allowed for that upload class.
//
// Mirrors the previous Supabase-Storage policy on a per-kind basis so the
// rest of the app doesn't have to change.

import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { uploadToS3 } from '@/lib/s3'
import { policyFor, mimeAllowed } from '@/lib/upload-policy'
import { NextResponse } from 'next/server'

// Allow long uploads — no app-level size cap. The actual ceiling is whatever
// the host/proxy in front of Node accepts; locally that's effectively
// unlimited.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Upload size cap removed by request — we only gate on MIME prefix so the
// bucket can't host arbitrary executables. NOTE: the real ceiling on this path
// is the reverse proxy (nginx client_max_body_size), which answers 413 before
// the request ever reaches here. Large files should use /api/upload/presign,
// which sends the bytes straight to S3 and has no such ceiling.
// The kind policy is shared with the presign route — see lib/upload-policy.

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    // Read the multipart body BEFORE any other async work. Some Next.js 16
    // runtime/proxy combos drop streamed bodies that aren't consumed in the
    // first tick — symptom is "Failed to parse body as FormData" on every
    // upload regardless of file type. Reading first sidesteps that.
    let formData: FormData
    try {
      formData = await request.formData()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Surface a useful 400 instead of the generic 500 the catch-all
      // produces, so the client toast actually tells the user what went
      // wrong (size / content-type / dropped connection).
      return NextResponse.json({
        error: `Could not read upload: ${msg}`,
      }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const kind = (formData.get('kind') as string | null) ?? 'projects'
    const policy = policyFor(kind)
    if (!policy) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })

    const mime = file.type || ''
    if (!mimeAllowed(policy, mime)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
    }
    if (policy.superAdminOnly) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Optional `folder` form-field — client passes a project id / slug so
    // the file lands under <kind>/<folder>/... instead of <kind>/<userId>/...
    // Sanitised here (no slashes, short) to avoid path-traversal mischief.
    const rawFolder = (formData.get('folder') as string | null)?.trim()
    const folder = rawFolder
      ? rawFolder.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || undefined
      : undefined

    const result = await uploadToS3({
      file,
      userId: user.id,
      kind,
      originalFilename: file.name,
      contentType: mime || undefined,
      folder,
    })

    return NextResponse.json({
      url: result.url,
      key: result.key,
      bytes: result.bytes,
      name: file.name,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
