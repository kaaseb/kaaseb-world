// Tannoor print route — reuses the same QuotationPrint component as Furn,
// passing the Tannoor project/items/quotation. We adapt the props shape with
// a thin server-side mapper so the PDF design stays consistent across both
// quotation systems.

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { QuotationPrint } from '@/components/furn/QuotationPrint'
import type {
  FurnProject, FurnItem, FurnQuotation, FurnSettings,
  TannoorProject, TannoorItem, TannoorQuotation,
} from '@/types'

export const dynamic = 'force-dynamic'

type ItemWithProduct = TannoorItem & {
  tannoor_products?: { id: string; name_en: string | null; name_ar: string | null; unit: string; price_sar: number; price_usd: number } | null
}

export default async function TannoorPrintPage({
  params,
}: {
  params: Promise<{ id: string; quotationId: string }>
}) {
  const { id, quotationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: project }, { data: items }, { data: quotation }, { data: settings }] = await Promise.all([
    supabase.from('tannoor_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('tannoor_items').select('*, tannoor_products(id, name_en, name_ar, unit, price_sar, price_usd)').eq('project_id', id).order('position'),
    supabase.from('tannoor_quotations').select('*').eq('id', quotationId).maybeSingle(),
    supabase.from('furn_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  if (!project || !quotation || !settings) notFound()

  const tProject = project as TannoorProject
  const tQuote = quotation as TannoorQuotation
  const tItems = (items || []) as ItemWithProduct[]
  const isRtl = tQuote.language === 'ar'

  // Adapt Tannoor → Furn-shaped props. Items use the product's price in the
  // chosen currency; the QuotationPrint component renders unit/qty/total
  // identically.
  const projectShim: FurnProject = {
    id: tProject.id,
    project_number: tProject.project_number,
    project_name: (isRtl ? tProject.project_name_ar : tProject.project_name_en) || tProject.project_name_en || tProject.project_name_ar || 'Project',
    company_name: (isRtl ? tProject.company_ar : tProject.company_en) || tProject.company_en || tProject.company_ar || '',
    engineer_name: (isRtl ? tProject.engineer_name_ar : tProject.engineer_name_en) || tProject.engineer_name_en || tProject.engineer_name_ar,
    engineer_phone: null,
    commercial_register: tProject.commercial_register,
    tax_number: tProject.tax_number,
    subject: tProject.subject,
    department_ids: [],
    payment_terms: tProject.payment_terms,
    delivery_terms: tProject.delivery_terms,
    offer_duration: tProject.offer_duration,
    special_conditions: tProject.special_conditions,
    // Tannoor doesn't track terms bilingually yet — the print page falls
    // back to the single-language column via pickTerm().
    payment_terms_en: null,
    payment_terms_ar: null,
    delivery_terms_en: null,
    delivery_terms_ar: null,
    offer_duration_en: null,
    offer_duration_ar: null,
    special_conditions_en: null,
    special_conditions_ar: null,
    stage: 'quoted',
    status: 'completed',
    boq_url: tProject.boq_url,
    boq_filename: tProject.boq_filename,
    spec_files: tProject.spec_files,
    drawing_files: tProject.drawing_files,
    other_files: [],
    source_client_project_id: null,
    ai_summary: tProject.ai_summary,
    ai_detected_departments: tProject.ai_detected_departments,
    ai_error: tProject.ai_error,
    created_by: tProject.created_by,
    created_at: tProject.created_at,
    updated_at: tProject.updated_at,
  }
  const itemsShim: FurnItem[] = tItems.map((it, idx) => ({
    id: it.id,
    project_id: it.project_id,
    position: it.position || idx + 1,
    description: it.description,
    // Tannoor items have no long descriptive line (that's a Furn-only field);
    // null renders nothing under the title in the shared print component.
    details: null,
    quantity: Number(it.quantity),
    unit: it.unit,
    // Edited line price (single-currency project); fall back to the catalog
    // price in the quote's currency if a line was never manually priced.
    unit_price: it.unit_price ?? (tQuote.currency === 'USD'
      ? (it.tannoor_products?.price_usd ?? 0)
      : (it.tannoor_products?.price_sar ?? 0)),
    notes: it.notes,
    ai_confidence: it.ai_confidence,
    created_at: it.created_at,
    updated_at: it.updated_at,
  }))
  const quotationShim: FurnQuotation = {
    id: tQuote.id,
    project_id: tQuote.project_id,
    quotation_number: tQuote.quotation_number,
    language: tQuote.language,
    vat_rate: Number(tQuote.vat_rate),
    subtotal: Number(tQuote.subtotal),
    vat_amount: Number(tQuote.vat_amount),
    total: Number(tQuote.total),
    pdf_url: tQuote.pdf_url,
    generated_by: tQuote.generated_by,
    generated_at: tQuote.generated_at,
  }

  return (
    <QuotationPrint
      project={projectShim}
      items={itemsShim}
      quotation={quotationShim}
      settings={settings as FurnSettings}
    />
  )
}
