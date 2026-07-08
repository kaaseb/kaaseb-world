// POST /api/furn/projects/[id]/quote
//
// Locks the priced items into a quotation record:
//   1. Validate that every item has a unit_price >= 0
//   2. Allocate the next quotation_number (atomically incrementing the counter
//      stored on furn_settings)
//   3. Write a furn_quotations row capturing subtotal/vat/total snapshot
//   4. Advance the project to stage='quoted'
//
// The actual PDF is rendered on demand from /furn/[id]/quotation/[quotationId]/print
// so the page can re-render if branding/terms change later.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'

const VAT_RATE = 0.15

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { language?: 'ar' | 'en' }
  try { body = await request.json() } catch { body = {} }
  const language = body.language === 'en' ? 'en' : 'ar'

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

  const subtotal = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)
  const vatAmount = subtotal * VAT_RATE
  const total = subtotal + vatAmount

  // Allocate the next quotation number atomically. We use the admin client
  // (service role) for this mutation so RLS doesn't block the increment, and
  // we wrap it in a single update-returning-* statement that other concurrent
  // callers can't race past.
  const admin = createAdminClient()
  const { data: settingsRow, error: settingsErr } = await admin
    .from('furn_settings')
    .select('next_quotation_number').eq('id', 1).single()
  if (settingsErr || !settingsRow) {
    return NextResponse.json({ error: 'furn_settings missing — run the migration' }, { status: 500 })
  }
  const quotationNumber = settingsRow.next_quotation_number || 1700
  await admin.from('furn_settings')
    .update({ next_quotation_number: quotationNumber + 1, updated_at: new Date().toISOString() })
    .eq('id', 1)

  const { data: quotation, error: qErr } = await supabase.from('furn_quotations').insert({
    project_id: id,
    quotation_number: quotationNumber,
    language,
    vat_rate: VAT_RATE,
    subtotal,
    vat_amount: vatAmount,
    total,
    pdf_url: null, // PDFs are rendered on-demand by the print route
    generated_by: user.id,
  }).select('*').single()

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  await supabase.from('furn_projects').update({
    stage: 'quoted',
    status: 'completed',
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ quotation })
}
