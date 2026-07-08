'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Sparkles, Send, Loader2, Plus, MessageSquare, Trash2, Users, Briefcase, CheckSquare, Target } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeShort } from '@/components/ui/time-ago'

interface AiConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface AiMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  profile: Profile
  initConversations: AiConversation[]
}

export function GhasslAiClient({ profile, initConversations }: Props) {
  const { t, isRtl } = useLanguage()
  const supabase = createClient()
  const [conversations, setConversations] = useState<AiConversation[]>(initConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const firstName = (profile.full_name || profile.email.split('@')[0] || '').split(' ')[0]

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    let cancel = false
    setLoadingMessages(true)
    supabase
      .from('ai_messages').select('id, role, content').eq('conversation_id', activeId).order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancel) return
        setMessages((data as AiMessage[]) || [])
        setLoadingMessages(false)
      })
    return () => { cancel = true }
  }, [activeId, supabase])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, sending])

  async function send(promptOverride?: string) {
    const text = (promptOverride ?? input).trim()
    if (!text || sending) return
    setSending(true)
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, message: text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])

      if (!activeId) {
        setActiveId(data.conversationId)
        const newConv: AiConversation = {
          id: data.conversationId,
          title: text.length > 50 ? text.slice(0, 50) + '…' : text,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        setConversations(prev => [newConv, ...prev])
      } else {
        setConversations(prev => prev.map(c =>
          c.id === activeId ? { ...c, updated_at: new Date().toISOString() } : c
        ))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai_error'))
      setMessages(prev => prev.slice(0, -1))
    }
    setSending(false)
  }

  function newConversation() {
    setActiveId(null)
    setMessages([])
    setInput('')
  }

  async function deleteConversation(id: string) {
    if (!confirm(t('ai_delete_confirm'))) return
    const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) newConversation()
  }

  const QUICK_GROUPS: { key: string; label: string; icon: typeof Users; color: string; prompts: string[] }[] = [
    { key: 'employees', label: t('ai_q_employees'), icon: Users, color: 'text-blue-600',
      prompts: [t('ai_q_top_points'), t('ai_q_no_active_tasks'), t('ai_q_team_perf')] },
    { key: 'projects', label: t('ai_q_projects'), icon: Briefcase, color: 'text-purple-600',
      prompts: [t('ai_q_all_projects_status'), t('ai_q_late_projects'), t('ai_q_resource_alloc')] },
    { key: 'tasks', label: t('ai_q_tasks'), icon: CheckSquare, color: 'text-emerald-600',
      prompts: [t('ai_q_overdue_tasks'), t('ai_q_high_priority'), t('ai_q_completion_stats')] },
    { key: 'goals', label: t('ai_q_goals'), icon: Target, color: 'text-amber-600',
      prompts: [t('ai_q_active_goals'), t('ai_q_at_risk_goals'), t('ai_q_goal_progress')] },
  ]

  return (
    <div className="flex h-screen bg-gradient-to-br from-sky-50/40 via-white to-cyan-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Sidebar with conversations */}
      <aside className="w-72 border-e border-gray-100 dark:border-white/10 bg-white/60 dark:bg-slate-900/60 backdrop-blur flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <button
            onClick={newConversation}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white text-sm font-medium hover:shadow-md transition-shadow"
          >
            <Plus className="w-4 h-4" />{t('ai_new_chat')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-6">{t('ai_no_chats')}</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map(c => (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                      activeId === c.id ? 'bg-sky-50 dark:bg-sky-500/15 text-sky-900 dark:text-sky-200' : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700'
                    }`}
                    onClick={() => setActiveId(c.id)}
                  >
                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${activeId === c.id ? 'text-sky-500' : 'text-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.title}</p>
                      <TimeShort iso={c.updated_at} className="text-[10px] text-gray-400" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 transition-opacity"
                      aria-label={t('delete')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-3 border-b border-gray-100 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 backdrop-blur flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">{t('ai_title')}</h1>
              <p className="text-[11px] text-gray-500">{t('ai_subtitle')}</p>
            </div>
          </div>
        </header>

        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto px-6 py-10 max-w-3xl w-full mx-auto">
            <div className="text-center mb-10">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-100 to-cyan-100 dark:from-sky-500/15 dark:to-cyan-500/10 border border-sky-200 dark:border-sky-400/25 flex items-center justify-center shadow-sm dark:shadow-none">
                <Sparkles className="w-8 h-8 text-sky-500" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900">{t('ai_hello')} {firstName} 👋</h2>
              <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto">{t('ai_intro')}</p>
            </div>
            <div className="space-y-6">
              {QUICK_GROUPS.map(group => {
                const GroupIcon = group.icon
                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <GroupIcon className={`w-4 h-4 ${group.color}`} />
                      <span className="text-sm font-semibold text-gray-700">{group.label}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {group.prompts.map(p => (
                        <button
                          key={p}
                          onClick={() => send(p)}
                          disabled={sending}
                          className="text-start text-sm bg-white dark:bg-slate-800/60 border border-gray-100 dark:border-white/10 rounded-xl px-4 py-3 hover:border-sky-200 dark:hover:border-sky-400/40 hover:shadow-sm transition-all disabled:opacity-50"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {loadingMessages && (
                <div className="text-center text-xs text-gray-400">…</div>
              )}
              {messages.map((m, i) => (
                <div key={m.id || i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-sky-500 to-cyan-500 dark:from-sky-600 dark:to-cyan-700 text-white rounded-se-md'
                      : 'bg-white dark:bg-slate-800/70 border border-gray-100 dark:border-white/10 text-gray-900 dark:text-slate-100 rounded-ss-md'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-white dark:bg-slate-800/70 border border-gray-100 dark:border-white/10 rounded-2xl rounded-ss-md px-4 py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-gray-100 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 backdrop-blur px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-white dark:bg-slate-800/70 rounded-2xl border border-gray-200 dark:border-white/10 focus-within:border-sky-300 dark:focus-within:border-sky-400/50 focus-within:ring-2 focus-within:ring-sky-100 dark:focus-within:ring-sky-500/20 px-3 py-2 shadow-sm dark:shadow-none">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={t('ai_placeholder')}
                rows={1}
                className="flex-1 resize-none border-0 focus:outline-none text-sm bg-transparent max-h-32 py-1.5"
                disabled={sending}
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || sending}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 text-white flex items-center justify-center disabled:opacity-40 hover:shadow-md transition-shadow"
                aria-label={t('chat_send')}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-2">{t('ai_send_hint')}</p>
          </div>
        </div>
      </main>
    </div>
  )
}
