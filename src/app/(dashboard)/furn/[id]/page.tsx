import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { FurnDetail } from '@/components/furn/FurnDetail'
import { getFurnExtras } from '@/lib/furn/project-extras'
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

  const [{ data: project }, { data: items }, { data: quotations }, extras] = await Promise.all([
    supabase.from('furn_projects').select('*').eq('id', id).maybeSingle(),
    supabase.from('furn_items').select('*').eq('project_id', id).order('position'),
    supabase.from('furn_quotations').select('*').eq('project_id', id).order('generated_at', { ascending: false }),
    // All BOQ files + imported notes/keywords (S3 extras — the row holds one BOQ).
    getFurnExtras(id),
  ])

  if (!project) notFound()

  return (
    <FurnDetail
      project={project as FurnProject}
      extras={extras}
      initialItems={(items || []) as FurnItem[]}
      initialQuotations={(quotations || []) as FurnQuotation[]}
      canEditPrices={hasPermission(profile, permissions, 'furn.pricing.edit')}
      canExport={hasPermission(profile, permissions, 'furn.quotation.export')}
    />
  )
}
