import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StoreClient } from '@/components/store/StoreClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function StorePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const profile = await getProfileOrFallback(supabase, user)

  const { data: rewards } = await supabase
    .from('rewards')
    .select('*')
    .order('required_points', { ascending: true })

  const { data: orders } = await supabase
    .from('reward_orders')
    .select(`*, rewards(name, image_url, required_points), profiles!user_id(full_name)`)
    .order('created_at', { ascending: false })

  // Total positive points this user has ever earned (for the "achievements" stat).
  let totalEarned = 0
  try {
    const { data: posPoints } = await supabase
      .from('pending_points')
      .select('points')
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .gt('points', 0)
    totalEarned = (posPoints || []).reduce((s, r) => s + (r.points || 0), 0)
  } catch { /* ignore */ }

  return (
    <StoreClient
      rewards={rewards || []}
      orders={orders || []}
      profile={profile}
      totalEarned={totalEarned}
    />
  )
}
