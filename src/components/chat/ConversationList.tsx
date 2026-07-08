'use client'

import { useState, useMemo } from 'react'
import { MessageSquarePlus, Search, Users, User as UserIcon, ImageIcon, Video, Paperclip } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeShort } from '@/components/ui/time-ago'
import type { ConvWithMembers } from './CommunityChatClient'

interface Props {
  currentUserId: string
  conversations: ConvWithMembers[]
  activeId: string | null
  setActiveId: (id: string) => void
  canCreateDm: boolean
  canCreateGroup: boolean
  onNewDm: () => void
  onNewGroup: () => void
}

export function ConversationList({ currentUserId, conversations, activeId, setActiveId, canCreateDm, canCreateGroup, onNewDm, onNewGroup }: Props) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'groups' | 'dms'>('groups')
  const [menuOpen, setMenuOpen] = useState(false)

  const counts = useMemo(() => ({
    groups: conversations.filter(c => c.type === 'group').length,
    dms: conversations.filter(c => c.type === 'dm').length,
  }), [conversations])

  const filtered = useMemo(() => {
    const byTab = conversations.filter(c => tab === 'groups' ? c.type === 'group' : c.type === 'dm')
    if (!query.trim()) return byTab
    const q = query.toLowerCase()
    return byTab.filter(c => displayName(c, currentUserId).toLowerCase().includes(q))
  }, [query, conversations, currentUserId, tab])

  return (
    <>
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
            {t('community_title')}
          </h1>
          {(canCreateDm || canCreateGroup) && (
            <div className="relative">
              <button
                onClick={() => {
                  if (canCreateDm && canCreateGroup) setMenuOpen(o => !o)
                  else if (canCreateDm) onNewDm()
                  else if (canCreateGroup) onNewGroup()
                }}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center hover:shadow-md transition-shadow"
                aria-label={t('chat_new')}
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
              {menuOpen && canCreateDm && canCreateGroup && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute end-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-20 min-w-[180px]">
                    <button
                      onClick={() => { setMenuOpen(false); onNewDm() }}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                    >
                      <UserIcon className="w-4 h-4 text-blue-600" />{t('chat_new_dm')}
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); onNewGroup() }}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Users className="w-4 h-4 text-purple-600" />{t('chat_new_group')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search')}
            className="w-full h-9 ps-9 pe-3 rounded-full bg-gray-50 border border-transparent focus:border-blue-300 focus:bg-white text-sm outline-none transition-colors"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-50 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'groups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {t('chat_tab_groups')}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === 'groups' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-500'}`}>
              {counts.groups}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('dms')}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
              tab === 'dms' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            {t('chat_tab_dms')}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === 'dms' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>
              {counts.dms}
            </span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
              {tab === 'groups' ? <Users className="w-6 h-6 text-indigo-500" /> : <MessageSquarePlus className="w-6 h-6 text-indigo-500" />}
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {tab === 'groups' ? t('chat_no_groups') : t('chat_no_dms')}
            </p>
            {tab === 'groups' && canCreateGroup && (
              <button onClick={onNewGroup} className="text-sm font-medium text-purple-600 hover:text-purple-700">
                {t('chat_new_group')}
              </button>
            )}
            {tab === 'dms' && canCreateDm && (
              <button onClick={onNewDm} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                {t('chat_start_first')}
              </button>
            )}
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {filtered.map(c => {
              const title = displayName(c, currentUserId)
              const avatar = displayAvatar(c, currentUserId)
              const isActive = c.id === activeId
              const me = c.chat_members.find(m => m.user_id === currentUserId)
              const lastReadAt = me?.last_read_at
              const unread = c.last_message && c.last_message.sender_id !== currentUserId && lastReadAt && new Date(c.last_message.created_at) > new Date(lastReadAt)
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full p-2.5 rounded-xl flex items-center gap-3 text-start transition-colors ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100'
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <div
                        className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center ${
                          c.type === 'group' ? 'bg-gradient-to-br from-purple-400 to-pink-400 text-white' : 'bg-gray-100'
                        }`}
                      >
                        {avatar ? (
                          <img src={avatar} alt="" className="w-full h-full object-cover" />
                        ) : c.type === 'group' ? (
                          <Users className="w-5 h-5" />
                        ) : (
                          <span className="text-sm font-bold text-gray-500">{title[0]?.toUpperCase() || '?'}</span>
                        )}
                      </div>
                      {unread && (
                        <span className="absolute top-0 end-0 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                          {title}
                        </p>
                        {c.last_message && (
                          <TimeShort iso={c.last_message.created_at} className="text-[10px] text-gray-400 flex-shrink-0" />
                        )}
                      </div>
                      <p className={`text-xs truncate mt-0.5 flex items-center gap-1 ${unread ? 'text-gray-700' : 'text-gray-500'}`}>
                        {renderPreview(c, t)}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

export function displayName(c: ConvWithMembers, currentUserId: string): string {
  if (c.type === 'group') return c.name || 'Group'
  const other = c.chat_members.find(m => m.user_id !== currentUserId)?.profiles as (import('@/types').Profile | null) | undefined
  const base = other?.full_name || other?.email?.split('@')[0] || '—'
  return other?.title ? `${base} · ${other.title}` : base
}

export function displayAvatar(c: ConvWithMembers, currentUserId: string): string | null {
  if (c.type === 'group') return c.image_url
  const other = c.chat_members.find(m => m.user_id !== currentUserId)?.profiles
  return other?.avatar_url || null
}

function renderPreview(c: ConvWithMembers, t: (k: 'chat_no_messages' | 'chat_photo' | 'chat_video' | 'chat_file' | 'you') => string) {
  const lm = c.last_message
  if (!lm) return <span className="italic text-gray-400">{t('chat_no_messages')}</span>
  if (lm.media_type && !lm.content) {
    const IconCmp = lm.media_type === 'image' ? ImageIcon : lm.media_type === 'video' ? Video : Paperclip
    const label = lm.media_type === 'image' ? t('chat_photo') : lm.media_type === 'video' ? t('chat_video') : t('chat_file')
    return <><IconCmp className="w-3 h-3" /><span>{label}</span></>
  }
  return <span className="truncate">{lm.content}</span>
}

