import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { FurnList } from '@/components/furn/FurnList'
import type { FurnProject } from '@/types'

export const dynamic = 'force-dynamic'

export default async function FurnPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    redirect('/dashboard')
  }

  const { data: projects } = await supabase
    .from('furn_projects').select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  const canCreate = hasPermission(profile, permissions, 'furn.projects.create')
  const canDelete = hasPermission(profile, permissions, 'furn.projects.delete')

  return <FurnList initialProjects={(projects || []) as FurnProject[]} canCreate={canCreate} canDelete={canDelete} />
}
