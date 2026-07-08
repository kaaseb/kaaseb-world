// POST /api/pre-qualifications/[id]/render
//
// Fetches the chosen documents from S3, merges them via pdf-lib, stamps
// the signature/seal from furn_settings, uploads the result back to S3,
// and stores the resulting URL on the row.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'
import { buildPreQualPdf } from '@/lib/pre-qualification-pdf'
import { getPreQualForProject } from '@/lib/prequal/store'
import { uploadToS3, deleteFromS3 } from '@/lib/s3'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1) Load the pre-qual row.
  const { data: pq } = await supabase
    .from('pre_qualifications').select('*').eq('id', id).maybeSingle()
  if (!pq) return NextResponse.json({ error: 'Pre-qualification not found' }, { status: 404 })

  const docIds: string[] = Array.isArray(pq.document_ids) ? pq.document_ids : []
  if (docIds.length === 0) {
    return NextResponse.json({ error: 'No documents picked for this packet' }, { status: 400 })
  }

  // Fetch the underlying documents (we need their URLs in the *order the
  // user specified*, so we resolve them ourselves rather than letting
  // Supabase reorder via .in()).
  const { data: docs } = await supabase
    .from('important_documents').select('id, file_url, name_en, name_ar').in('id', docIds)
  const byId = new Map((docs || []).map(d => [d.id as string, d]))
  // Keep the user's chosen order, and carry each doc's name for the TOC.
  const orderedDocs = docIds
    .map(id => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d?.file_url))
    .map(d => ({
      url: d.file_url as string,
      name_en: (d.name_en as string | null) ?? null,
      name_ar: (d.name_ar as string | null) ?? null,
    }))

  // Cover + back templates + TOC title — per-packet override if set, else the
  // admin-uploaded defaults (S3).
  const templates = await getPreQualForProject(id)

  // 2) Build the merged PDF: cover → auto TOC → documents → back.
  try {
    const pdfBytes = await buildPreQualPdf({
      documents: orderedDocs,
      coverUrl:  templates.cover_url,
      backUrl:   templates.back_url,
      tocTitle:  { ar: templates.toc_title_ar, en: templates.toc_title_en },
    })

    // 3) Upload to S3 under the prequal/ prefix.
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
    const uploaded = await uploadToS3({
      file: blob,
      userId: user.id,
      kind: 'prequal',
      originalFilename: `prequal-${pq.id}.pdf`,
      contentType: 'application/pdf',
    })

    // 4) Replace any previous output (best-effort cleanup) and persist.
    const admin = createAdminClient()
    if (pq.output_pdf_key && pq.output_pdf_key !== uploaded.key) {
      try { await deleteFromS3(pq.output_pdf_key) } catch { /* ignore */ }
    }
    const { data: updated, error: upErr } = await admin
      .from('pre_qualifications')
      .update({
        output_pdf_url: uploaded.url,
        output_pdf_key: uploaded.key,
        generated_at:   new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({ item: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
