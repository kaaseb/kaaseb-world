import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GhasslAiClient } from '@/components/ai/GhasslAiClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function AiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  const { data: conversations } = await supabase
    .from('ai_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  return <GhasslAiClient profile={profile} initConversations={conversations || []} />
}
