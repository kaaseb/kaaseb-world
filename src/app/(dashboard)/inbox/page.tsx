import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { getInboxState } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { InboxClient } from '@/components/inbox/InboxClient'
import { InboxLock } from '@/components/inbox/InboxLock'

export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) redirect('/dashboard')

  const isSuperAdmin = profile.role === 'super_admin'

  // Secret gate on top of the permission — even authorised users must enter the
  // PIN the super admin controls before any customer email is loaded.
  if (!(await inboxUnlocked())) return <InboxLock />

  const { items, lastRun } = await getInboxState()
  const canCreateProject = hasPermission(profile, permissions, 'client_projects.create')

  return <InboxClient initialItems={items} initialLastRun={lastRun} canCreateProject={canCreateProject} isSuperAdmin={isSuperAdmin} />
}
