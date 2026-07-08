'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Trash2, Volume2, VolumeX, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { Story, Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeAgo } from '@/components/ui/time-ago'
import { gradientById } from './gradients'

type StoryWithAuthor = Story & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
}

interface Props {
  stories: StoryWithAuthor[]
  currentUserId: string
  isSuperAdmin?: boolean
  onClose: () => void
  onDeleteStory: (id: string) => void
  onMarkViewed?: (storyIds: string[]) => void
}

export function StoryViewer({ stories, currentUserId, isSuperAdmin, onClose, onDeleteStory, onMarkViewed }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [idx, setIdx] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [muted, setMuted] = useState(true) // autoplay policy: start muted
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [viewersOpen, setViewersOpen] = useState(false)
  const [viewers, setViewers] = useState<Array<{ user_id: string; viewed_at: string; profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null }>>([])
  const [loadingViewers, setLoadingViewers] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Record view for the current story (only when viewing others' stories)
  useEffect(() => {
    const story = stories[idx]
    if (!story || story.user_id === currentUserId) return
    // Fire-and-forget; unique constraint prevents duplicates
    supabase
      .from('story_views')
      .upsert({ story_id: story.id, user_id: currentUserId }, { onConflict: 'story_id,user_id' })
      .then(() => onMarkViewed?.([story.id]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, stories])

  // Auto-advance — 5s for images/text, wait for end for videos.
  useEffect(() => {
    const story = stories[idx]
    if (!story) return
    if (story.type === 'video') {
      // Video stories advance via the <video onEnded> handler below.
      return
    }
    const tm = setTimeout(() => {
      if (idx + 1 >= stories.length) onClose()
      else setIdx(i => i + 1)
    }, 5000)
    return () => clearTimeout(tm)
  }, [idx, stories, onClose])

  // Esc to close
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, stories.length - 1))
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, stories.length])

  if (!mounted) return null
  const story = stories[idx]
  if (!story) return null
  const isMine = story.user_id === currentUserId
  const canManage = isMine || isSuperAdmin

  async function loadViewers() {
    if (!canManage) return
    setViewersOpen(true)
    setLoadingViewers(true)
    const { data } = await supabase
      .from('story_views')
      .select('user_id, viewed_at, profiles(id, full_name, email, avatar_url)')
      .eq('story_id', story.id)
      .order('viewed_at', { ascending: false })
    setViewers(((data as unknown) as typeof viewers) || [])
    setLoadingViewers(false)
  }

  async function deleteStory() {
    if (!confirm(t('story_delete_confirm'))) return
    const { error } = await supabase.from('stories').delete().eq('id', story.id)
    if (error) toast.error(error.message)
    else {
      onDeleteStory(story.id)
      toast.success(t('deleted'))
      if (stories.length === 1) onClose()
      else setIdx(i => Math.max(0, i - 1))
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={onClose}>
      {/* Top bar: progress + author */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex-1 flex gap-1">
          {stories.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
              <div className={`h-full bg-white transition-all ${i < idx ? 'w-full' : i === idx ? 'w-full animate-[storyProgress_5s_linear]' : 'w-0'}`} />
            </div>
          ))}
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="absolute top-12 start-4 flex items-center gap-2 text-white z-10" onClick={(e) => e.stopPropagation()}>
        <div className="w-9 h-9 rounded-full bg-white/20 overflow-hidden flex items-center justify-center">
          {story.profiles?.avatar_url
            ? <img src={story.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="text-sm font-bold">{(story.profiles?.full_name || story.profiles?.email || 'U')[0].toUpperCase()}</span>}
        </div>
        <div>
          <p className="text-sm font-medium">{story.profiles?.full_name || story.profiles?.email?.split('@')[0]}</p>
          <TimeAgo iso={story.created_at} short className="text-[11px] text-white/60" />
        </div>
        {canManage && (
          <>
            <button onClick={loadViewers} className="ms-3 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-xs">
              <Eye className="w-3.5 h-3.5" />{t('story_viewers')}
            </button>
            <button onClick={deleteStory} className="p-2 rounded-full hover:bg-white/10 text-white/70">
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Viewers panel */}
      {viewersOpen && (
        <div
          className="absolute end-4 top-24 z-30 w-72 max-h-[60vh] bg-white text-gray-900 rounded-xl shadow-xl border border-gray-100 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold">{t('story_viewers')} <span className="text-gray-400">({viewers.length})</span></p>
            <button onClick={() => setViewersOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          {loadingViewers ? (
            <div className="p-6 text-center text-sm text-gray-400">…</div>
          ) : viewers.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">{t('story_no_viewers')}</div>
          ) : (
            <ul className="overflow-y-auto max-h-[55vh] divide-y divide-gray-50">
              {viewers.map(v => (
                <li key={v.user_id} className="px-4 py-2 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {v.profiles?.avatar_url
                      ? <img src={v.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[10px] font-bold text-gray-500">{(v.profiles?.full_name || v.profiles?.email || 'U')[0].toUpperCase()}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{v.profiles?.full_name || v.profiles?.email}</p>
                    <p className="text-[11px] text-gray-400">{new Date(v.viewed_at).toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Prev/Next tap zones */}
      {idx > 0 && (
        <button
          className="absolute start-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
          onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1) }}
        ><ChevronLeft className="w-5 h-5" /></button>
      )}
      {idx < stories.length - 1 && (
        <button
          className="absolute end-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center z-10"
          onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1) }}
        ><ChevronRight className="w-5 h-5" /></button>
      )}

      {/* Story content */}
      <div
        className="w-full max-w-md h-[80vh] max-h-[720px] rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ background: story.type === 'text' ? gradientById(story.bg_color) : '#000' }}
        onClick={(e) => e.stopPropagation()}
      >
        {story.type === 'text' && (
          <p className="text-white text-2xl font-bold text-center px-8 leading-relaxed break-words">
            {story.text_content}
          </p>
        )}
        {story.type === 'image' && story.media_url && (
          <img src={story.media_url} alt="" className="w-full h-full object-cover" />
        )}
        {story.type === 'video' && story.media_url && (
          <>
            <video
              ref={videoRef}
              key={story.id}
              src={story.media_url}
              autoPlay
              playsInline
              muted={muted}
              controls
              onEnded={() => {
                if (idx + 1 >= stories.length) onClose()
                else setIdx(i => i + 1)
              }}
              className="w-full h-full object-contain"
            />
            <button
              onClick={(e) => {
                e.stopPropagation()
                setMuted(m => !m)
                // Try to play (some browsers pause after muted change)
                videoRef.current?.play().catch(() => {})
              }}
              className="absolute top-20 end-4 w-11 h-11 rounded-full bg-white/20 backdrop-blur hover:bg-white/30 text-white flex items-center justify-center z-20"
              aria-label={muted ? 'unmute' : 'mute'}
              title={muted ? t('story_tap_for_sound') : t('story_mute')}
            >
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            {muted && (
              <div className="absolute bottom-8 inset-x-0 flex justify-center pointer-events-none">
                <span className="text-[11px] font-medium text-white bg-black/50 backdrop-blur px-3 py-1.5 rounded-full">
                  🔇 {t('story_tap_for_sound')}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes storyProgress { from { width: 0 } to { width: 100% } }
      `}</style>
    </div>,
    document.body
  )
}

