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
import { denyUnlessPermitted } from '@/lib/api-guard'
import { renderQuotationPdf } from '@/lib/quotation-pdf'
import { uploadBufferToS3 } from '@/lib/s3'
import { resolveShipping } from '@/lib/furn/delivery-store'
import { computeTotals } from '@/lib/quotation/totals'
import { reconcileQuotationRows } from '@/lib/quotation/reconcile'
import { getProjectItemFlags } from '@/lib/furn/item-flags'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'

export const runtime = 'nodejs'
export const maxDuration = 300

const VAT_RATE = 0.15
const LANGUAGES: Array<'ar' | 'en'> = ['ar', 'en']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('furn.quotation.export')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Server-side authorization: generating quotations (allocates the number,
  // renders PDFs via Puppeteer, writes to S3) must require furn access, not just
  // any authenticated session — matching the process/flags/send-quote routes.
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: project }, { data: items }] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
  ])
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'No items to quote' }, { status: 400 })
  }

  // Rejected review-flagged rows leave the quotation: they aren't priced, aren't
  // counted, and don't block the "all priced" gate — MUST match the print page
  // and the /quote route, or the PDF total wouldn't equal the sum of its lines.
  const flags = await getProjectItemFlags(id)
  const activeItems = items.filter((it) => flags[it.id]?.status !== 'rejected')
  if (activeItems.length === 0) {
    return NextResponse.json({ error: 'كل البنود مرفوضة — لا يوجد ما يُسعَّر' }, { status: 400 })
  }
  const unpriced = activeItems.filter(it => it.unit_price === null || it.unit_price === undefined)
  if (unpriced.length > 0) {
    return NextResponse.json({
      error: `${unpriced.length} item(s) have no price set yet`,
      unpriced_ids: unpriced.map(it => it.id),
    }, { status: 400 })
  }

  // ONE totals function for every surface (Furn / Tannoor / manual). "Not
  // included" delivery adds a priced shipping line into the subtotal (so VAT
  // applies to it and it flows into the grand total).
  const shipping = await resolveShipping(id)
  const totals = computeTotals(activeItems, shipping, VAT_RATE)

  // One quotation number per project, shared by both AR and EN PDFs.
  // First time we finalize a project we allocate a fresh number; every
  // subsequent re-issue reuses it so the customer sees a consistent
  // identifier no matter how many times we re-render.
  const admin = createAdminClient()

  // Shared reconciliation (Furn + Tannoor): one number per project, one row per
  // language, legacy duplicates removed, no dependency on a unique index — so
  // "Re-issue" always lands on a clean AR + EN pair.
  const nowIso = new Date().toISOString()
  let created: Array<{ id: string; language: 'ar' | 'en'; quotation_number: number }>
  try {
    const rec = await reconcileQuotationRows({
      db: admin,
      table: 'furn_quotations',
      projectId: id,
      writeLanguages: LANGUAGES,
      allocate: async () => {
        const { data: settingsRow } = await admin
          .from('furn_settings').select('next_quotation_number').eq('id', 1).single()
        if (!settingsRow) throw new Error('furn_settings missing — run the migration')
        const n = settingsRow.next_quotation_number || 1700
        await admin.from('furn_settings')
          .update({ next_quotation_number: n + 1, updated_at: nowIso })
          .eq('id', 1)
        return n
      },
      build: () => ({
        vat_rate: VAT_RATE,
        subtotal: totals.subtotal,
        vat_amount: totals.vat,
        total: totals.total,
        pdf_url: null,
        generated_by: user.id,
        generated_at: nowIso,
      }),
    })
    created = rec.rows
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save quotation' }, { status: 500 })
  }

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
      // Named so the DOWNLOADED file is "Kaaseb_<n>-<lang>.pdf" (the browser uses
      // the S3 key basename for a direct download):
      //   furn/quotations/<project-id>/Kaaseb_<n>-<lang>.pdf
      const key = `furn/quotations/${id}/Kaaseb_${q.quotation_number}-${q.language}.pdf`
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
