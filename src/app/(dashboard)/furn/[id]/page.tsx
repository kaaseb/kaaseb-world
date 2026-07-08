import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { FurnDetail } from '@/components/furn/FurnDetail'
import type { FurnProject, FurnItem, FurnQuotation } from '@/types'

export const dynamic = 'force-dynamic'

export default async function FurnProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) redirect('/dashboard')

  const [{ data: project }, { data: items }, { data: quotations }] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
    supabase.from('furn_quotations').select('*').eq('project_id', id).order('generated_at', { ascending: false }),
  ])

  if (!project) notFound()

  return (
    <FurnDetail
      project={project as FurnProject}
      initialItems={(items || []) as FurnItem[]}
      initialQuotations={(quotations || []) as FurnQuotation[]}
      canEditPrices={hasPermission(profile, permissions, 'furn.pricing.edit')}
      canExport={hasPermission(profile, permissions, 'furn.quotation.export')}
    />
  )
}
