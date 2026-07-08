import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { QuotationPrint } from '@/components/furn/QuotationPrint'
import { resolveDeliveryNote, resolveShipping } from '@/lib/furn/delivery-store'
import type { FurnProject, FurnItem, FurnQuotation, FurnSettings } from '@/types'

export const dynamic = 'force-dynamic'

export default async function QuotationPrintPage({
  params,
}: {
  params: Promise<{ id: string; quotationId: string }>
}) {
  const { id, quotationId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: project }, { data: items }, { data: quotation }, { data: settings }] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
    supabase.from('furn_quotations').select('*').eq('id', quotationId).maybeSingle(),
    supabase.from('furn_settings').select('*').eq('id', 1).maybeSingle(),
  ])

  if (!project || !quotation || !settings) notFound()

  const lang = (quotation as FurnQuotation).language
  // "Delivery included" sentence (only when the project is marked included).
  const deliveryNote = await resolveDeliveryNote(id, lang)
  // "Not included" → a priced shipping line appended to the items so it shows
  // in the table and matches the shipping already folded into the stored total.
  const shipping = await resolveShipping(id)
  const printItems = [...((items || []) as FurnItem[])]
  if (shipping > 0) {
    printItems.push({
      id: 'shipping',
      project_id: id,
      position: printItems.length + 1,
      description: lang === 'ar' ? 'التوصيل' : 'Delivery',
      details: null,
      quantity: 1,
      unit: lang === 'ar' ? 'مقطوعية' : 'lot',
      unit_price: shipping,
      notes: null,
      ai_confidence: null,
      created_at: '',
      updated_at: '',
    })
  }

  return (
    <QuotationPrint
      project={project as FurnProject}
      items={printItems}
      quotation={quotation as FurnQuotation}
      settings={settings as FurnSettings}
      deliveryNote={deliveryNote}
    />
  )
}
