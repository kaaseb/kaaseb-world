import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { DepartmentDetailClient } from '@/components/departments/DepartmentDetailClient'

export default async function DepartmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { data: department } = await supabase
    .from('departments')
    .select('*')
    .eq('id', id)
    .single()

  if (!department) notFound()

  const [
    { data: members },
    { data: jobDescriptions },
    { data: links },
    { data: projects },
    { data: achievements },
    { data: goals },
    { data: evaluationCriteria },
    { data: allUsers },
    { data: recurringTasks },
    { data: files },
    { data: checklist },
  ] = await Promise.all([
    supabase.from('department_members').select('*, profiles(id, full_name, email, avatar_url, role, total_points), department_member_job_descriptions(job_description_id, job_descriptions(id, role_name))').eq('department_id', id),
    supabase.from('job_descriptions').select('*').eq('department_id', id).order('created_at'),
    supabase.from('important_links').select('*').eq('department_id', id).order('created_at'),
    supabase.from('projects').select('*, tasks(count)').eq('department_id', id).order('created_at', { ascending: false }),
    supabase.from('achievements').select('*').eq('department_id', id).order('created_at', { ascending: false }),
    supabase.from('goals').select('*, goal_steps(*)').eq('department_id', id).order('created_at', { ascending: false }),
    supabase.from('evaluation_criteria').select('*').eq('department_id', id).order('created_at'),
    supabase.from('profiles').select('id, full_name, email, avatar_url, role').order('full_name'),
    supabase.from('department_recurring_tasks').select('*').eq('department_id', id).order('created_at'),
    supabase.from('department_files').select('*').eq('department_id', id).order('created_at', { ascending: false }),
    supabase.from('department_checklist').select('*').eq('department_id', id).order('position'),
  ])

  const isSuperAdmin = profile?.role === 'super_admin'
  const isDepartmentMember = (members || []).some(m => m.user_id === profile?.id)

  // Visibility: only super-admin or members of THIS department can view it.
  if (!isSuperAdmin && !isDepartmentMember) notFound()

  // Edit/delete is restricted to super-admin and department managers (a member
  // flagged with is_department_manager). Regular members are read-only.
  const myMembership = (members || []).find(m => m.user_id === profile?.id)
  const isDepartmentManager = !!profile?.is_department_manager && !!myMembership
  const canManage = isSuperAdmin || isDepartmentManager

  return (
    <DepartmentDetailClient
      department={department}
      members={members || []}
      jobDescriptions={jobDescriptions || []}
      links={links || []}
      projects={projects || []}
      achievements={achievements || []}
      goals={goals || []}
      evaluationCriteria={evaluationCriteria || []}
      allUsers={allUsers || []}
      recurringTasks={recurringTasks || []}
      files={files || []}
      checklist={checklist || []}
      profile={profile}
      isSuperAdmin={isSuperAdmin}
      canManage={canManage}
    />
  )
}
