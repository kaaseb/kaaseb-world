import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { TannoorDetail } from '@/components/tannoor/TannoorDetail'
import { getFxSettings, resolveRate } from '@/lib/settings/fx'
import type { TannoorProject, TannoorItem, TannoorQuotation } from '@/types'

export const dynamic = 'force-dynamic'

export default async function TannoorProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.tannoor')) redirect('/dashboard')

  const [{ data: project }, { data: items }, { data: quotations }] = await Promise.all([
    supabase.from('tannoor_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('tannoor_items').select('*, tannoor_products(id, name_en, name_ar, unit, price_sar, price_usd, availability)').eq('project_id', id).order('position'),
    supabase.from('tannoor_quotations').select('*').eq('project_id', id).order('generated_at', { ascending: false }),
  ])
  if (!project) notFound()

  // null = manual mode (use each product's own price_usd). A number = SAR per
  // USD; the client derives USD prices from SAR at this rate, matching the
  // server's quote/process math so the preview never disagrees with the PDF.
  const usdRate = resolveRate(await getFxSettings())

  return (
    <TannoorDetail
      project={project as TannoorProject}
      initialItems={(items || []) as TannoorItem[]}
      initialQuotations={(quotations || []) as TannoorQuotation[]}
      canExport={hasPermission(profile, permissions, 'tannoor.quotation.export')}
      usdRate={usdRate}
    />
  )
}
