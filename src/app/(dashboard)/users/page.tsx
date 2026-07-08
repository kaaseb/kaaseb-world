import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { UsersClient } from '@/components/users/UsersClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  if (profile.role !== 'super_admin') redirect('/dashboard')

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  // Departments per user via department_members
  const { data: memberships } = await supabase
    .from('department_members')
    .select('user_id, departments(id, name)')

  const departmentMap: Record<string, { id: string; name: string; status: string }[]> = {}
  for (const m of memberships || []) {
    if (!m.user_id || !m.departments) continue
    const dept = m.departments as unknown as { id: string; name: string }
    departmentMap[m.user_id] ??= []
    if (!departmentMap[m.user_id].find(d => d.id === dept.id)) {
      departmentMap[m.user_id].push({ id: dept.id, name: dept.name, status: 'active' })
    }
  }

  const { data: customRoles } = await supabase
    .from('custom_roles')
    .select('id, name, description, permissions')
    .order('name')

  return (
    <UsersClient
      users={users || []}
      currentProfile={profile}
      userProjects={departmentMap}
      customRoles={customRoles || []}
    />
  )
}
