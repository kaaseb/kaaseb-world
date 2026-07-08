import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ClientProjectForm } from '@/components/client-projects/ClientProjectForm'
import type { ProfileLite } from '@/types'

export const dynamic = 'force-dynamic'

export default async function NewClientProjectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'client_projects.create')) redirect('/projects')

  const admin = createAdminClient()
  const { data: allProfiles } = await admin
    .from('profiles')
    .select('id, full_name, email, avatar_url')
    .order('full_name')

  return <ClientProjectForm mode="create" profiles={(allProfiles || []) as ProfileLite[]} />
}
