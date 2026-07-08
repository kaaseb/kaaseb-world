import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ClientProjectForm } from '@/components/client-projects/ClientProjectForm'
import type { ClientProject, ProfileLite } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ClientProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.client_projects')) redirect('/dashboard')

  const admin = createAdminClient()
  const [{ data: project }, { data: allProfiles }] = await Promise.all([
    supabase
      .from('client_projects')
      .select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)')
      .eq('id', id).maybeSingle(),
    admin.from('profiles').select('id, full_name, email, avatar_url').order('full_name'),
  ])
  if (!project) notFound()

  return (
    <ClientProjectForm
      mode="edit"
      initial={project as ClientProject}
      profiles={(allProfiles || []) as ProfileLite[]}
      canEdit={hasPermission(profile, permissions, 'client_projects.edit')}
      canDelete={hasPermission(profile, permissions, 'client_projects.delete')}
    />
  )
}
