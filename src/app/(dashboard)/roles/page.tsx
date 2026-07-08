import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RolesClient } from '@/components/roles/RolesClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function RolesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') redirect('/dashboard')

  const { data: roles } = await supabase
    .from('custom_roles')
    .select('*')
    .order('created_at', { ascending: false })

  return <RolesClient profile={profile} initRoles={roles || []} />
}
