// Manual-quote print route — renders the SAME QuotationPrint component as Furn
// and Tannoor (one approved template for every quotation type). A thin shim maps
// the S3-stored ManualQuote onto the Furn-shaped props; branding (header image,
// seal, footer, default terms) comes from furn_settings so the three surfaces
// are pixel-identical.

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { QuotationPrint } from '@/components/furn/QuotationPrint'
import { getManualQuote } from '@/lib/manual-quotes/store'
import { resolveQuoteTerms } from '@/lib/quote-terms/store'
import type { FurnProject, FurnItem, FurnQuotation, FurnSettings } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ManualQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const quote = await getManualQuote(id)
  if (!quote) notFound()

  // Branding lives in furn_settings (shared with Furn/Tannoor). Fall back to an
  // empty object so a manual quote still prints even if the row is absent —
  // QuotationPrint treats every missing field as "not shown".
  const { data: settingsRow } = await supabase.from('furn_settings').select('*').eq('id', 1).maybeSingle()
  const settings = (settingsRow || {}) as FurnSettings

  const lang = quote.language
  const itemsSum = quote.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  // Delivery: "included" → a note only; "excluded" → a priced line folded into the
  // subtotal (so VAT applies and it flows into the grand total). Mirrors Furn.
  const shipping = quote.delivery === 'excluded' ? Math.max(0, Number(quote.shipping) || 0) : 0
  const deliveryNote =
    quote.delivery === 'included'
      ? lang === 'ar' ? 'الأسعار شاملة التوصيل.' : 'Prices include delivery.'
      : null
  const subtotal = itemsSum + shipping
  const vatAmount = subtotal * (quote.vat_rate || 0)
  const total = subtotal + vatAmount

  const tc = await resolveQuoteTerms(`manual:${quote.id}`, quote.language)

  const projectShim: FurnProject = {
    id: quote.id,
    project_number: quote.number,
    project_name: quote.project_name || quote.company || '—',
    company_name: quote.company,
    engineer_name: quote.client_name || null,
    engineer_phone: quote.phone || null,
    commercial_register: null,
    tax_number: null,
    subject: quote.subject || null,
    department_ids: [],
    // No per-quote terms on a manual quote — fall through to the settings
    // defaults, exactly like a Furn project with blank terms.
    payment_terms: null, delivery_terms: null, offer_duration: null, special_conditions: null,
    payment_terms_en: null, payment_terms_ar: null,
    delivery_terms_en: null, delivery_terms_ar: null,
    offer_duration_en: null, offer_duration_ar: null,
    special_conditions_en: null, special_conditions_ar: null,
    stage: 'quoted',
    status: 'completed',
    boq_url: null, boq_filename: null,
    spec_files: [], drawing_files: [], other_files: [],
    source_client_project_id: null,
    ai_summary: null, ai_detected_departments: [], ai_error: null,
    created_by: quote.createdBy,
    created_at: quote.createdAt,
    updated_at: quote.updatedAt,
  }

  const itemsShim: Array<FurnItem & { imageUrl?: string | null; custom?: Record<string, string> }> = quote.items.map((it, idx) => ({
    id: it.id,
    project_id: quote.id,
    position: idx + 1,
    description: it.description,
    details: it.details || null,
    quantity: Number(it.quantity) || 0,
    unit: it.unit,
    unit_price: it.unit_price,
    notes: it.notes || null,
    ai_confidence: null,
    created_at: quote.createdAt,
    updated_at: quote.updatedAt,
    imageUrl: it.imageUrl || null,
    custom: it.custom || {},
  }))

  // "Not included" → append a priced delivery line so it shows in the table and
  // matches the shipping folded into the subtotal above.
  if (shipping > 0) {
    itemsShim.push({
      id: 'shipping',
      project_id: quote.id,
      position: itemsShim.length + 1,
      description: lang === 'ar' ? 'التوصيل' : 'Delivery',
      details: null,
      quantity: 1,
      unit: lang === 'ar' ? 'مقطوعية' : 'lot',
      unit_price: shipping,
      notes: null,
      ai_confidence: null,
      created_at: quote.createdAt,
      updated_at: quote.updatedAt,
      imageUrl: null,
      custom: {},
    })
  }

  const quotationShim: FurnQuotation = {
    id: quote.id,
    project_id: quote.id,
    quotation_number: quote.number,
    language: quote.language,
    vat_rate: quote.vat_rate,
    subtotal,
    vat_amount: vatAmount,
    total,
    pdf_url: null,
    generated_by: quote.createdBy,
    generated_at: quote.createdAt,
  }

  return (
    <QuotationPrint
      project={projectShim}
      items={itemsShim}
      quotation={quotationShim}
      settings={settings}
      currency={quote.currency}
      extraColumns={quote.columns || []}
      deliveryNote={deliveryNote}
      terms={tc.show ? tc.lines : []}
    />
  )
}
