// POST /api/furn/projects/[id]/finalize
//
// One click → two quotations + two persisted PDFs.
//
// Pipeline:
//   1. Validate every item has a price.
//   2. Allocate two quotation numbers (one for Arabic, one for English) by
//      bumping furn_settings.next_quotation_number twice.
//   3. Insert two furn_quotations rows (subtotal/vat/total snapshots).
//   4. For each, boot Puppeteer, navigate to the existing print page, save
//      the resulting PDF buffer to S3 under
//      `furn/quotations/<projectId>/<quotation-number>-<lang>.pdf`, and
//      back-fill `pdf_url` on the quotation row.
//   5. Flip the project to stage='quoted' / status='completed'.
//   6. Return both quotations to the UI which then renders two download
//      buttons.
//
// PDFs and DB rows are coupled: if a render fails we still keep the DB row
// (with pdf_url=null) so the user can retry just the PDF later.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'
import { renderQuotationPdf } from '@/lib/quotation-pdf'
import { uploadBufferToS3 } from '@/lib/s3'
import { resolveShipping } from '@/lib/furn/delivery-store'

export const runtime = 'nodejs'
export const maxDuration = 300

const VAT_RATE = 0.15
const LANGUAGES: Array<'ar' | 'en'> = ['ar', 'en']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: project }, { data: items }] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
  ])
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'No items to quote' }, { status: 400 })
  }
  const unpriced = items.filter(it => it.unit_price === null || it.unit_price === undefined)
  if (unpriced.length > 0) {
    return NextResponse.json({
      error: `${unpriced.length} item(s) have no price set yet`,
      unpriced_ids: unpriced.map(it => it.id),
    }, { status: 400 })
  }

  const itemsSum = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)
  // "Not included" delivery adds a priced shipping line into the subtotal (so
  // VAT applies to it and it flows into the grand total).
  const shipping = await resolveShipping(id)
  const subtotal = itemsSum + shipping
  const vatAmount = subtotal * VAT_RATE
  const total = subtotal + vatAmount

  // One quotation number per project, shared by both AR and EN PDFs.
  // First time we finalize a project we allocate a fresh number; every
  // subsequent re-issue reuses it so the customer sees a consistent
  // identifier no matter how many times we re-render.
  const admin = createAdminClient()
  const { data: existing } = await supabase
    .from('furn_quotations')
    .select('quotation_number')
    .eq('project_id', id)
    .order('quotation_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let quotationNumber: number
  if (existing?.quotation_number) {
    quotationNumber = existing.quotation_number
  } else {
    const { data: settingsRow } = await admin
      .from('furn_settings').select('next_quotation_number').eq('id', 1).single()
    if (!settingsRow) {
      return NextResponse.json({ error: 'furn_settings missing — run the migration' }, { status: 500 })
    }
    quotationNumber = settingsRow.next_quotation_number || 1700
    await admin.from('furn_settings')
      .update({ next_quotation_number: quotationNumber + 1, updated_at: new Date().toISOString() })
      .eq('id', 1)
  }

  // Upsert both rows: matching (project_id, quotation_number, language)
  // triples are updated with fresh totals and pdf_url=null (the renderer
  // backfills the URL below). New rows are inserted. This is what makes
  // "Re-issue" idempotent — clicking Send twice doesn't duplicate.
  const rows = LANGUAGES.map(lang => ({
    project_id: id,
    quotation_number: quotationNumber,
    language: lang,
    vat_rate: VAT_RATE,
    subtotal,
    vat_amount: vatAmount,
    total,
    pdf_url: null,
    generated_by: user.id,
  }))
  const { data: created, error: qErr } = await supabase
    .from('furn_quotations')
    .upsert(rows, { onConflict: 'project_id,quotation_number,language' })
    .select('*')
  if (qErr || !created) return NextResponse.json({ error: qErr?.message || 'Upsert failed' }, { status: 500 })

  // The print page is server-rendered and needs a real origin. Use the
  // request's origin header (works for localhost AND prod) so we don't
  // need an env var.
  const origin = request.headers.get('origin') || new URL(request.url).origin
  const cookieHeader = request.headers.get('cookie') || ''

  // Render in series — Puppeteer reuses a single Chromium across both
  // calls, but two parallel page.goto's against the same dev server tend
  // to deadlock Next's per-route lock.
  const results: Array<{ id: string; language: 'ar' | 'en'; pdf_url: string | null; pdf_error?: string }> = []
  for (const q of created) {
    try {
      const pdf = await renderQuotationPdf({
        origin,
        projectId: id,
        quotationId: q.id,
        cookieHeader,
      })
      // Stable, recognisable key in the bucket browser:
      //   furn/quotations/<project-id>/<n>-<lang>.pdf
      const key = `furn/quotations/${id}/${q.quotation_number}-${q.language}.pdf`
      const up = await uploadBufferToS3({
        buffer: pdf,
        key,
        contentType: 'application/pdf',
      })
      await admin.from('furn_quotations')
        .update({ pdf_url: up.url })
        .eq('id', q.id)
      results.push({ id: q.id, language: q.language, pdf_url: up.url })
    } catch (e) {
      // Don't bail out: the DB rows already exist; the user can retry.
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ id: q.id, language: q.language, pdf_url: null, pdf_error: msg })
    }
  }

  await supabase.from('furn_projects').update({
    stage: 'quoted',
    status: 'completed',
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Re-fetch the final quotation rows so the response carries the now-
  // populated `pdf_url`s the UI needs to render its download buttons.
  const { data: quotations } = await supabase
    .from('furn_quotations').select('*').in('id', created.map(q => q.id))

  return NextResponse.json({ quotations: quotations || [], results })
}
