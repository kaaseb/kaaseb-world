'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search, Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'
import type { ConvWithMembers } from './CommunityChatClient'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUserId: string
  allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  existingConversations: ConvWithMembers[]
  onCreated: (conv: ConvWithMembers) => void
}

export function NewChatDialog({ open, onOpenChange, currentUserId, allUsers, existingConversations, onCreated }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return allUsers
    const q = query.toLowerCase()
    return allUsers.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [query, allUsers])

  async function startDm(user: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>) {
    // If a DM with this user already exists, just activate it
    const existing = existingConversations.find(c =>
      c.type === 'dm' && c.chat_members.some(m => m.user_id === user.id) && c.chat_members.some(m => m.user_id === currentUserId),
    )
    if (existing) {
      onCreated(existing)
      onOpenChange(false)
      return
    }

    setCreating(user.id)
    const { data: conv, error } = await supabase
      .from('chat_conversations')
      .insert({ type: 'dm', created_by: currentUserId })
      .select('*')
      .single()
    if (error || !conv) { toast.error(error?.message || 'Failed'); setCreating(null); return }

    const { error: memErr } = await supabase.from('chat_members').insert([
      { conversation_id: conv.id, user_id: currentUserId, is_admin: true },
      { conversation_id: conv.id, user_id: user.id, is_admin: false },
    ])
    if (memErr) { toast.error(memErr.message); setCreating(null); return }

    const { data: membersData } = await supabase
      .from('chat_members')
      .select('*, profiles(id, full_name, email, avatar_url, title)')
      .eq('conversation_id', conv.id)

    onCreated({
      ...conv,
      chat_members: (membersData || []) as ConvWithMembers['chat_members'],
      last_message: null,
    })
    setCreating(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader><DialogTitle>{t('chat_new_dm')}</DialogTitle></DialogHeader>
        <div className="relative mt-2">
          <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('chat_search_users')} className="ps-9" />
        </div>
        <div className="mt-3 flex-1 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">{t('no_data')}</p>
          ) : filtered.map(u => (
            <button
              key={u.id}
              onClick={() => startDm(u)}
              disabled={creating === u.id}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 text-start disabled:opacity-60"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                {u.avatar_url
                  ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <span className="text-sm font-bold text-gray-500">{(u.full_name || u.email)[0].toUpperCase()}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              {creating === u.id && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
