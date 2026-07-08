import { createClient } from '@/lib/supabase/server'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { data: notifications } = await supabase
    .from('notifications')
    .select(`*, profiles!sender_id(full_name, avatar_url)`)
    .or(`recipient_id.eq.${user!.id},is_broadcast.eq.true`)
    .gte('created_at', profile?.created_at ?? new Date(0).toISOString())
    .order('created_at', { ascending: false })

  return <NotificationsClient notifications={notifications || []} profile={profile} />
}
