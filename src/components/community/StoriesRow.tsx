'use client'

import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { Story, Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { CreateStoryDialog } from './CreateStoryDialog'
import { StoryViewer } from './StoryViewer'
import { gradientById } from './gradients'

type StoryWithAuthor = Story & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
}

interface Props {
  currentUserId: string
  isSuperAdmin?: boolean
  stories: StoryWithAuthor[]
  setStories: React.Dispatch<React.SetStateAction<StoryWithAuthor[]>>
  viewedSet: Set<string>
  onMarkViewed: (storyIds: string[]) => void
  currentUserAvatar: string | null
  currentUserName: string | null
}

export function StoriesRow({ currentUserId, isSuperAdmin, stories, setStories, viewedSet, onMarkViewed, currentUserAvatar, currentUserName }: Props) {
  const { t, isRtl } = useLanguage()
  const [createOpen, setCreateOpen] = useState(false)
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)

  // Group stories by user, keeping newest order. Current user's bubble shown first.
  const groups = useMemo(() => {
    const byUser = new Map<string, StoryWithAuthor[]>()
    for (const s of stories) {
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, [])
      byUser.get(s.user_id)!.push(s)
    }
    // Sort groups: current user first, then by newest story
    const arr = Array.from(byUser.values())
    arr.sort((a, b) => {
      if (a[0].user_id === currentUserId) return -1
      if (b[0].user_id === currentUserId) return 1
      return new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime()
    })
    return arr
  }, [stories, currentUserId])

  const myStories = groups.find(g => g[0].user_id === currentUserId)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {/* Create story bubble */}
        <button
          onClick={() => setCreateOpen(true)}
          className="group flex-shrink-0 flex flex-col items-center gap-1.5"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 group-hover:border-blue-400 transition-colors">
              {currentUserAvatar
                ? <img src={currentUserAvatar} alt="" className="w-full h-full object-cover" />
                : <span className="text-lg font-bold text-gray-500">{(currentUserName || 'U')[0].toUpperCase()}</span>}
            </div>
            <div className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center border-2 border-white shadow">
              <Plus className="w-3.5 h-3.5" strokeWidth={3} />
            </div>
          </div>
          <span className="text-[11px] font-medium text-gray-700 max-w-[70px] truncate">
            {myStories ? t('story_your_story') : t('story_create_short')}
          </span>
        </button>

        {/* Divider */}
        {groups.filter(g => g[0].user_id !== currentUserId).length > 0 && (
          <div className="w-px h-12 bg-gray-100 flex-shrink-0" />
        )}

        {/* Other users' story bubbles */}
        {groups.map(group => {
          const first = group[0]
          const isMe = first.user_id === currentUserId
          const preview = first.type === 'text' ? first.bg_color : null
          // "fully viewed" if every story in the group is in viewedSet (own stories always counted)
          const allViewed = isMe ? true : group.every(s => viewedSet.has(s.id))
          const ringBg = allViewed
            ? '#e5e7eb' // gray-200 — muted ring for viewed
            : first.type === 'text'
              ? gradientById(preview)
              : 'linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)'
          return (
            <button
              key={first.user_id}
              onClick={() => setViewingUserId(first.user_id)}
              className="group flex-shrink-0 flex flex-col items-center gap-1.5"
            >
              <div
                className="p-[2px] rounded-full transition-opacity"
                style={{ background: ringBg }}
              >
                <div className={`w-16 h-16 rounded-full bg-white p-[2px] flex items-center justify-center ${allViewed && !isMe ? 'opacity-80' : ''}`}>
                  {first.profiles?.avatar_url ? (
                    <img src={first.profiles.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : first.type === 'image' && first.media_url ? (
                    <img src={first.media_url} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <div className="w-full h-full rounded-full bg-gray-100 flex items-center justify-center">
                      <span className="text-lg font-bold text-gray-500">
                        {(first.profiles?.full_name || first.profiles?.email || 'U')[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <span className={`text-[11px] font-medium max-w-[70px] truncate ${allViewed && !isMe ? 'text-gray-400' : 'text-gray-700'}`}>
                {isMe ? t('story_you') : (first.profiles?.full_name || first.profiles?.email?.split('@')[0] || '—')}
              </span>
            </button>
          )
        })}

        {groups.length === 0 && (
          <div className="flex-1 text-center text-sm text-gray-400 py-3">
            {t('stories_empty')}
          </div>
        )}
      </div>

      <CreateStoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        userId={currentUserId}
        onCreated={(s) => setStories([{ ...(s as StoryWithAuthor), profiles: { id: currentUserId, full_name: currentUserName, email: '', avatar_url: currentUserAvatar, title: null } }, ...stories])}
      />

      {viewingUserId && (
        <StoryViewer
          stories={groups.find(g => g[0].user_id === viewingUserId) || []}
          onClose={() => setViewingUserId(null)}
          onDeleteStory={(id) => setStories(stories.filter(s => s.id !== id))}
          onMarkViewed={onMarkViewed}
          currentUserId={currentUserId}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </div>
  )
}
