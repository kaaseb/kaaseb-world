import { createClient } from '@/lib/supabase/server'
import { ProjectsClient } from '@/components/projects/ProjectsClient'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const isSuperAdmin = profile?.role === 'super_admin'

  const { data: projects } = await supabase
    .from('projects')
    .select(`*, departments(name), tasks(count)`)
    .order('created_at', { ascending: false })

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name')
    .order('name')

  return (
    <ProjectsClient
      projects={projects || []}
      departments={departments || []}
      profile={profile}
      isSuperAdmin={isSuperAdmin}
    />
  )
}
