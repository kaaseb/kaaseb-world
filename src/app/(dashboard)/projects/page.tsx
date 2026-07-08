import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ClientProjectsList } from '@/components/client-projects/ClientProjectsList'
import type { ClientProject } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ClientProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.client_projects')) redirect('/dashboard')

  // Hydrate the responsible_user join so the table can render owner names
  // without a second round-trip. The full profile list (for the form's
  // dropdown) is fetched on the /projects/new and /projects/[id] routes.
  const { data: projects } = await supabase
    .from('client_projects')
    .select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(500)

  return (
    <ClientProjectsList
      initialProjects={(projects || []) as ClientProject[]}
      canCreate={hasPermission(profile, permissions, 'client_projects.create')}
      canDelete={hasPermission(profile, permissions, 'client_projects.delete')}
    />
  )
}
