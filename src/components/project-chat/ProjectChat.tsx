'use client'

// One project's internal team chat. Reuses the existing realtime chat tables +
// MessageBubble + MessageComposer (text / image / video / file / voice note).
//
// Layout is height-bounded by the parent (the floating panel or the project tab)
// and is flex-column with a scrolling message area, so it fits full-screen on
// mobile and a fixed panel on desktop without the page scrolling.

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, MessagesSquare } from 'lucide-react'
import type { Profile, ChatMessage } from '@/types'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { MessageComposer } from '@/components/chat/MessageComposer'

interface Props {
  projectId: string
  currentUser: Profile
}

type Author = { full_name: string | null; email: string | null; avatar_url: string | null }

export function ProjectChat({ projectId, currentUser }: Props) {
  const supabase = createClient()
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [authors, setAuthors] = useState<Record<string, Author>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ensure the conversation exists (server maps projectId → conversationId).
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/client-projects/${projectId}/chat`, { method: 'POST' })
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) { setError(j.error || 'تعذّر فتح الدردشة'); setLoading(false); return }
        setConvId(j.conversationId)
      } catch { if (alive) { setError('تعذّر فتح الدردشة'); setLoading(false) } }
    })()
    return () => { alive = false }
  }, [projectId])

  // Author profiles (RLS open) for name/avatar on each bubble.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, email, avatar_url')
      if (!alive || !data) return
      const map: Record<string, Author> = {}
      for (const p of data as Array<{ id: string } & Author>) map[p.id] = p
      setAuthors(map)
    })()
    return () => { alive = false }
  }, [supabase])

  // Initial message load once the conversation id is known. Inlined (not a
  // callback called from the effect body) so no setState runs synchronously in
  // the effect — every state update here happens after the awaited fetch.
  useEffect(() => {
    if (!convId) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('chat_messages').select('*')
        .eq('conversation_id', convId).is('deleted_at', null)
        .order('created_at', { ascending: true }).limit(500)
      if (!alive) return
      setMessages((data || []) as ChatMessage[])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [convId, supabase])

  // Realtime: append inserts, reflect edits/deletes.
  useEffect(() => {
    if (!convId) return
    const channel = supabase
      .channel(`proj-chat-${convId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new as ChatMessage
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new as ChatMessage
          setMessages((prev) => m.deleted_at ? prev.filter((x) => x.id !== m.id) : prev.map((x) => x.id === m.id ? m : x))
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [convId, supabase])

  // Keep pinned to the newest message.
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [messages.length])

  async function send(content: string, mediaUrl: string | null, mediaType: 'image' | 'video' | 'file' | null) {
    if (!convId || (!content.trim() && !mediaUrl)) return
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ conversation_id: convId, sender_id: currentUser.id, content: content.trim() || null, media_url: mediaUrl, media_type: mediaType })
      .select('*').single()
    if (error) toast.error(error.message)
    else if (data) setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data as ChatMessage]))
  }

  async function del(messageId: string) {
    const { error } = await supabase.from('chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId)
    if (error) toast.error(error.message)
    else setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-50/60">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-2 min-h-0">
        {error ? (
          <div className="flex items-center justify-center h-full text-center text-sm text-red-600 px-4">{error}</div>
        ) : loading || !convId ? (
          <div className="flex items-center justify-center h-full"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
            <MessagesSquare className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">ابدأ النقاش حول هذا المشروع</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1]
            const sameAuthor = !!prev && prev.sender_id === m.sender_id
              && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000
            const a = authors[m.sender_id]
            return (
              <MessageBubble
                key={m.id}
                message={m}
                isMine={m.sender_id === currentUser.id}
                authorName={a?.full_name || a?.email?.split('@')[0] || '—'}
                authorAvatar={a?.avatar_url || null}
                showAuthor={!sameAuthor && m.sender_id !== currentUser.id}
                showAvatar={!sameAuthor}
                onDelete={(m.sender_id === currentUser.id || currentUser.role === 'super_admin') ? () => del(m.id) : undefined}
              />
            )
          })
        )}
      </div>
      <MessageComposer onSend={send} />
    </div>
  )
}
