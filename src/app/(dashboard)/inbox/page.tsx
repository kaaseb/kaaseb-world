import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { getInboxState } from '@/lib/inbox/store'
import { InboxClient } from '@/components/inbox/InboxClient'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) redirect('/dashboard')

  const { items, lastRun } = await getInboxState()
  const canCreateProject = hasPermission(profile, permissions, 'client_projects.create')

  return <InboxClient initialItems={items} initialLastRun={lastRun} canCreateProject={canCreateProject} />
}
