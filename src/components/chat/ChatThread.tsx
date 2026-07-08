'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Users, Info, Loader2, User as UserIcon, Search, X, Mail } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile, ChatMessage } from '@/types'
import { displayName, displayAvatar } from './ConversationList'
import type { ConvWithMembers } from './CommunityChatClient'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { GroupInfoDialog } from './GroupInfoDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Props {
  conversation: ConvWithMembers
  currentUser: Profile
  allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  onConversationUpdate: (c: ConvWithMembers) => void
}

export function ChatThread({ conversation, currentUser, allUsers, onConversationUpdate }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages
    const q = searchQuery.toLowerCase()
    return messages.filter(m => (m.content || '').toLowerCase().includes(q))
  }, [messages, searchQuery])

  const otherUser = conversation.type === 'dm'
    ? conversation.chat_members.find(m => m.user_id !== currentUser.id)?.profiles ?? null
    : null

  const title = displayName(conversation, currentUser.id)
  const avatar = displayAvatar(conversation, currentUser.id)
  const subtitle = conversation.type === 'group'
    ? `${conversation.chat_members.length} ${t('members_count')}`
    : conversation.chat_members.find(m => m.user_id !== currentUser.id)?.profiles?.email || ''

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500)
    setMessages((data || []) as ChatMessage[])
    setLoading(false)
  }, [conversation.id, supabase])

  useEffect(() => { load() }, [load])

  // Realtime subscription — append new messages, handle edits/deletes
  useEffect(() => {
    const channel = supabase
      .channel(`chat-conv-${conversation.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const msg = payload.new as ChatMessage
          setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
        },
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversation.id}` },
        (payload) => {
          const msg = payload.new as ChatMessage
          setMessages(prev => msg.deleted_at
            ? prev.filter(m => m.id !== msg.id)
            : prev.map(m => m.id === msg.id ? msg : m))
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversation.id, supabase])

  // Scroll to bottom when messages change (skip while searching to keep results stable)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (searchQuery.trim()) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, searchQuery])

  async function deleteMessage(messageId: string) {
    if (!confirm(t('chat_delete_confirm'))) return
    const { error } = await supabase
      .from('chat_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) toast.error(error.message)
    else {
      setMessages(prev => prev.filter(m => m.id !== messageId))
      toast.success(t('chat_message_deleted'))
    }
  }

  async function sendMessage(content: string, mediaUrl: string | null, mediaType: 'image' | 'video' | 'file' | null) {
    if (!content.trim() && !mediaUrl) return
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversation.id,
        sender_id: currentUser.id,
        content: content.trim() || null,
        media_url: mediaUrl,
        media_type: mediaType,
      })
      .select('*')
      .single()
    if (error) toast.error(error.message)
    else if (data) {
      // Optimistic insert (realtime may also deliver — dedupe)
      setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data as ChatMessage]))
      // Notify other members by email. Fire-and-forget so the chat stays
      // snappy even if SMTP is slow.
      fetch('/api/email/dm-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: data.id }),
      }).catch(() => {})
    }
  }

  // Member lookup by id (for message author avatar in groups)
  const memberById = new Map(
    conversation.chat_members.map(m => [m.user_id, m.profiles]),
  )

  return (
    <>
      <header className="px-5 border-b border-gray-100 bg-white/70 backdrop-blur">
        <div className="h-16 flex items-center gap-3">
          <div className="relative">
            <div className={`w-10 h-10 rounded-full overflow-hidden flex items-center justify-center ${
              conversation.type === 'group' ? 'bg-gradient-to-br from-purple-400 to-pink-400 text-white' : 'bg-gray-100'
            }`}>
              {avatar
                ? <img src={avatar} alt="" className="w-full h-full object-cover" />
                : conversation.type === 'group'
                  ? <Users className="w-4 h-4" />
                  : <UserIcon className="w-4 h-4 text-gray-500" />}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
            <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
          </div>
          <button
            onClick={() => { setSearchOpen(o => !o); if (searchOpen) setSearchQuery('') }}
            className={`p-2 rounded-full hover:bg-gray-100 ${searchOpen ? 'text-blue-600 bg-blue-50' : 'text-gray-500'}`}
            aria-label={t('chat_search')}
            title={t('chat_search')}
          >
            <Search className="w-4 h-4" />
          </button>
          {conversation.type === 'group' ? (
            <button onClick={() => setInfoOpen(true)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500" title={t('chat_about_group')}>
              <Info className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={() => setContactOpen(true)} className="p-2 rounded-full hover:bg-gray-100 text-gray-500" title={t('chat_about_contact')}>
              <Info className="w-4 h-4" />
            </button>
          )}
        </div>

        {searchOpen && (
          <div className="pb-3 -mt-1">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('chat_search_ph')}
                className="w-full h-9 ps-9 pe-9 rounded-full bg-gray-50 border border-transparent focus:border-blue-300 focus:bg-white text-sm outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={t('clear')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <p className="text-[11px] text-gray-500 mt-1.5 ms-1">
                {visibleMessages.length} {visibleMessages.length === 1 ? t('chat_search_result') : t('chat_search_results')}
              </p>
            )}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              {searchQuery.trim() ? (
                <p className="text-sm text-gray-400">{t('chat_search_none')}</p>
              ) : (
                <>
                  <p className="text-sm text-gray-400">{t('chat_no_messages_yet')}</p>
                  <p className="text-xs text-gray-300 mt-1">{t('chat_send_first')}</p>
                </>
              )}
            </div>
          </div>
        ) : (
          visibleMessages.map((m, i) => {
            const prev = visibleMessages[i - 1]
            const sameAuthorAsPrev = prev && prev.sender_id === m.sender_id
              && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
            const author = memberById.get(m.sender_id)
            return (
              <MessageBubble
                key={m.id}
                message={m}
                isMine={m.sender_id === currentUser.id}
                authorName={author?.full_name || author?.email?.split('@')[0] || '—'}
                authorAvatar={author?.avatar_url || null}
                showAuthor={conversation.type === 'group' && !sameAuthorAsPrev && m.sender_id !== currentUser.id}
                showAvatar={conversation.type === 'group' && !sameAuthorAsPrev}
                onDelete={(m.sender_id === currentUser.id || currentUser.role === 'super_admin') ? () => deleteMessage(m.id) : undefined}
              />
            )
          })
        )}
      </div>

      <MessageComposer onSend={sendMessage} />

      {conversation.type === 'group' && (
        <GroupInfoDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          conversation={conversation}
          currentUser={currentUser}
          allUsers={allUsers}
          onConversationUpdate={onConversationUpdate}
        />
      )}

      {conversation.type === 'dm' && (
        <Dialog open={contactOpen} onOpenChange={setContactOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{t('chat_about_contact')}</DialogTitle></DialogHeader>
            <div className="text-center py-2">
              <div className="w-20 h-20 mx-auto rounded-full bg-gray-100 overflow-hidden flex items-center justify-center mb-3">
                {otherUser?.avatar_url
                  ? <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-bold text-gray-400">{(otherUser?.full_name || otherUser?.email || 'U')[0].toUpperCase()}</span>}
              </div>
              <p className="text-base font-semibold text-gray-900">{otherUser?.full_name || otherUser?.email?.split('@')[0]}</p>
              {otherUser?.title && (
                <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-amber-700 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-100 rounded-full px-2 py-0.5">
                  💪 {otherUser.title}
                </span>
              )}
              {otherUser?.email && (
                <a href={`mailto:${otherUser.email}`} className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500 hover:text-blue-600">
                  <Mail className="w-3.5 h-3.5" />{otherUser.email}
                </a>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
