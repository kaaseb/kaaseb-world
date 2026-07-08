import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { TannoorList } from '@/components/tannoor/TannoorList'
import type { TannoorProject } from '@/types'

export const dynamic = 'force-dynamic'

export default async function TannoorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.tannoor')) redirect('/dashboard')

  const { data: projects } = await supabase
    .from('tannoor_projects').select('*').order('created_at', { ascending: false }).limit(500)

  return (
    <TannoorList
      initialProjects={(projects || []) as TannoorProject[]}
      canCreate={hasPermission(profile, permissions, 'tannoor.projects.create')}
      canDelete={hasPermission(profile, permissions, 'tannoor.projects.delete')}
    />
  )
}
