import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CommunityChatClient } from '@/components/chat/CommunityChatClient'
import { getProfileOrFallback } from '@/lib/profile'
import type { Profile, ChatConversation, ChatMember } from '@/types'

export default async function CommunityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  // Conversations I'm a member of
  let conversations: (ChatConversation & {
    chat_members: (ChatMember & { profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null })[]
    last_message: { content: string | null; sender_id: string; created_at: string; media_type: string | null } | null
  })[] = []
  let allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[] = []
  let employeesCanCreateDm = false

  try {
    const { data: cfg } = await supabase.from('app_config').select('employees_can_create_dm').eq('id', 1).single()
    employeesCanCreateDm = !!cfg?.employees_can_create_dm
  } catch { /* table may not exist */ }

  try {
    const [membershipsRes, usersRes] = await Promise.all([
      supabase
        .from('chat_members')
        .select(`
          conversation_id,
          last_read_at,
          chat_conversations!inner (
            *,
            chat_members ( *, profiles ( id, full_name, email, avatar_url, title ) )
          )
        `)
        .eq('user_id', user.id),
      supabase.from('profiles').select('id, full_name, email, avatar_url').neq('id', user.id).order('full_name'),
    ])

    type Row = {
      conversation_id: string
      last_read_at: string
      chat_conversations: ChatConversation & {
        chat_members: (ChatMember & { profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null })[]
      }
    }
    const rows = (membershipsRes.data || []) as unknown as Row[]
    const convs = rows.map(r => r.chat_conversations).filter(Boolean)

    // Fetch last message per conversation
    const lastByConv: Record<string, { content: string | null; sender_id: string; created_at: string; media_type: string | null } | null> = {}
    if (convs.length > 0) {
      const { data: lastMsgs } = await supabase
        .from('chat_messages')
        .select('conversation_id, content, sender_id, created_at, media_type')
        .in('conversation_id', convs.map(c => c.id))
        .order('created_at', { ascending: false })
      for (const m of lastMsgs || []) {
        if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m
      }
    }

    conversations = convs.map(c => ({ ...c, last_message: lastByConv[c.id] || null }))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    allUsers = usersRes.data || []
  } catch { /* tables may not exist yet */ }

  const isSuperAdmin = profile.role === 'super_admin'
  const canCreateDm = isSuperAdmin || employeesCanCreateDm
  const canCreateGroup = isSuperAdmin

  return (
    <CommunityChatClient
      profile={profile}
      initConversations={conversations}
      allUsers={allUsers}
      canCreateDm={canCreateDm}
      canCreateGroup={canCreateGroup}
    />
  )
}
