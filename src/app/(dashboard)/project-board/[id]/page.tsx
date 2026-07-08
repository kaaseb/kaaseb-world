import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ProjectDetailClient } from '@/components/projects/ProjectDetailClient'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { data: project } = await supabase
    .from('projects')
    .select('*, departments(id, name)')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const [
    { data: tasks },
    { data: members },
    { data: achievements },
    { data: evaluationCriteria },
    { data: checklist },
  ] = await Promise.all([
    supabase.from('tasks').select('*, profiles!assigned_user_id(id, full_name, avatar_url)').eq('project_id', id).order('position', { ascending: true }),
    supabase.from('department_members').select('*, profiles(id, full_name, avatar_url)').eq('department_id', project.department_id),
    supabase.from('project_achievements').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('project_evaluation_criteria').select('*').eq('project_id', id).order('created_at'),
    supabase.from('project_checklist').select('*').eq('project_id', id).order('created_at'),
  ])

  return (
    <ProjectDetailClient
      project={project}
      tasks={tasks || []}
      members={members || []}
      profile={profile}
      achievements={achievements || []}
      evaluationCriteria={evaluationCriteria || []}
      checklist={checklist || []}
    />
  )
}
