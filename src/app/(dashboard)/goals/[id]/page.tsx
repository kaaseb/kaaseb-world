import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { GoalRoadmapDetail } from '@/components/goals/GoalRoadmapDetail'

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/dashboard')

  const { data: goal } = await supabase
    .from('goals')
    .select('*, goal_steps(*, goal_step_tasks(*)), owner:owner_id(id, full_name, email, avatar_url), departments(id, name)')
    .eq('id', id)
    .single()

  if (!goal) notFound()

  const { data: members } = await supabase
    .from('profiles').select('id, full_name, email, avatar_url').order('full_name')

  return <GoalRoadmapDetail profile={profile} goal={goal} allMembers={members ?? []} />
}
