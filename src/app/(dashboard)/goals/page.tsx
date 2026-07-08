import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { GoalsRoadmapClient } from '@/components/goals/GoalsRoadmapClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function GoalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  const admin = createAdminClient()

  const [
    { data: goals },
    { data: departments },
    { data: allProfiles },
  ] = await Promise.all([
    supabase.from('goals').select('*, goal_steps(*), departments(name)').order('order_index', { ascending: true }).order('created_at', { ascending: false }),
    supabase.from('departments').select('id, name').order('name'),
    admin.from('profiles').select('id, full_name, email, avatar_url').order('full_name'),
  ])

  return (
    <GoalsRoadmapClient
      profile={profile}
      initGoals={goals ?? []}
      departments={departments ?? []}
      allProfiles={allProfiles ?? []}
    />
  )
}
