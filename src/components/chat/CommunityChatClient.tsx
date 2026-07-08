'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, ChatConversation, ChatMember } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { ConversationList } from './ConversationList'
import { ChatThread } from './ChatThread'
import { NewChatDialog } from './NewChatDialog'
import { NewGroupDialog } from './NewGroupDialog'
import { MessageSquareText } from 'lucide-react'

export type ConvWithMembers = ChatConversation & {
  chat_members: (ChatMember & { profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null })[]
  last_message: { content: string | null; sender_id: string; created_at: string; media_type: string | null } | null
}

interface Props {
  profile: Profile
  initConversations: ConvWithMembers[]
  allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  canCreateDm: boolean
  canCreateGroup: boolean
}

export function CommunityChatClient({ profile, initConversations, allUsers, canCreateDm, canCreateGroup }: Props) {
  const { t, isRtl } = useLanguage()
  const supabase = createClient()
  const [conversations, setConversations] = useState(initConversations)
  const [activeId, setActiveId] = useState<string | null>(initConversations[0]?.id ?? null)
  const [dmOpen, setDmOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)

  const activeConv = useMemo(
    () => conversations.find(c => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  // Realtime: new messages across ALL my conversations → bump preview + re-sort
  useEffect(() => {
    const myConvIds = conversations.map(c => c.id)
    if (myConvIds.length === 0) return
    const channel = supabase
      .channel('chat-global')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=in.(${myConvIds.join(',')})` },
        (payload) => {
          const msg = payload.new as { id: string; conversation_id: string; content: string | null; sender_id: string; created_at: string; media_type: string | null }
          setConversations(prev => {
            const next = prev.map(c => c.id === msg.conversation_id
              ? { ...c, updated_at: msg.created_at, last_message: { content: msg.content, sender_id: msg.sender_id, created_at: msg.created_at, media_type: msg.media_type } }
              : c)
            return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length])

  function upsertConversation(c: ConvWithMembers, activate = true) {
    setConversations(prev => {
      const exists = prev.some(x => x.id === c.id)
      const next = exists ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]
      return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    })
    if (activate) setActiveId(c.id)
  }

  async function markRead(convId: string) {
    await supabase
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('user_id', profile.id)
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c
      return {
        ...c,
        chat_members: c.chat_members.map(m => m.user_id === profile.id ? { ...m, last_read_at: new Date().toISOString() } : m),
      }
    }))
  }

  useEffect(() => {
    if (activeId) markRead(activeId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  return (
    <div
      className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Left: conversation list */}
      <aside className="w-full sm:w-80 lg:w-96 flex-shrink-0 border-e border-gray-100 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 backdrop-blur flex flex-col">
        <ConversationList
          currentUserId={profile.id}
          conversations={conversations}
          activeId={activeId}
          setActiveId={setActiveId}
          canCreateDm={canCreateDm}
          canCreateGroup={canCreateGroup}
          onNewDm={() => setDmOpen(true)}
          onNewGroup={() => setGroupOpen(true)}
        />
      </aside>

      {/* Right: thread */}
      <main className="flex-1 min-w-0 flex flex-col">
        {activeConv ? (
          <ChatThread
            key={activeConv.id}
            conversation={activeConv}
            currentUser={profile}
            allUsers={allUsers}
            onConversationUpdate={(c) => upsertConversation(c, false)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg">
                <MessageSquareText className="w-10 h-10 text-white" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-bold text-gray-900">{t('chat_empty_title')}</h2>
              <p className="text-sm text-gray-500 mt-2 max-w-md">{t('chat_empty_hint')}</p>
            </div>
          </div>
        )}
      </main>

      <NewChatDialog
        open={dmOpen}
        onOpenChange={setDmOpen}
        currentUserId={profile.id}
        allUsers={allUsers}
        existingConversations={conversations}
        onCreated={upsertConversation}
      />
      <NewGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        currentUserId={profile.id}
        allUsers={allUsers}
        onCreated={upsertConversation}
      />
    </div>
  )
}
