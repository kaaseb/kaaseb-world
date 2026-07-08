import { createClient } from '@/lib/supabase/server'
import { DepartmentsClient } from '@/components/departments/DepartmentsClient'

export default async function DepartmentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const isSuperAdmin = profile?.role === 'super_admin'
  // Department managers (members flagged with `is_department_manager`) get
  // the same UI affordances as super-admins on this page: they can create
  // new departments and have full control over the ones they manage.
  const isDepartmentManager = !!profile?.is_department_manager
  const canCreateDept = isSuperAdmin || isDepartmentManager

  // Non-super-admins can only see departments they are a member of.
  let visibleDeptIds: string[] | null = null
  if (!isSuperAdmin) {
    const { data: myMemberships } = await supabase
      .from('department_members')
      .select('department_id')
      .eq('user_id', user!.id)
    visibleDeptIds = (myMemberships || []).map(m => m.department_id)
  }

  let query = supabase
    .from('departments')
    .select(`
      *,
      department_members(count),
      projects(count)
    `)
    .order('created_at', { ascending: false })

  if (visibleDeptIds !== null) {
    if (visibleDeptIds.length === 0) {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    } else {
      query = query.in('id', visibleDeptIds)
    }
  }

  const { data: departments } = await query

  // Managers need the user list too so they can pick department members.
  const { data: allUsers } = canCreateDept
    ? await supabase.from('profiles').select('id, full_name, email, avatar_url, role')
    : { data: [] }

  if (!profile) return null

  return (
    <DepartmentsClient
      departments={departments || []}
      profile={profile}
      allUsers={allUsers || []}
      isSuperAdmin={canCreateDept}
    />
  )
}
