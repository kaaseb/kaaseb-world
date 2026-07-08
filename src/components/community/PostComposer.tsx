'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Send, ImageIcon, Video, Loader2, X, BarChart3, FileText, Plus } from 'lucide-react'
import type { Post, Profile, PostPollOption } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

type PostWithAuthor = Post & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
  poll_options?: PostPollOption[]
}

interface Props {
  userId: string
  userAvatar: string | null
  userName: string | null
  onPosted: (post: PostWithAuthor) => void
}

export function PostComposer({ userId, userAvatar, userName, onPosted }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [mode, setMode] = useState<'normal' | 'poll'>('normal')
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File, type: 'image' | 'video') {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'posts')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) { setMediaUrl(result.url); setMediaType(type) }
    else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  function setOption(idx: number, value: string) {
    setPollOptions(prev => prev.map((v, i) => i === idx ? value : v))
  }
  function addOption() {
    if (pollOptions.length >= 10) return
    setPollOptions(prev => [...prev, ''])
  }
  function removeOption(idx: number) {
    if (pollOptions.length <= 2) return
    setPollOptions(prev => prev.filter((_, i) => i !== idx))
  }

  async function publish() {
    if (mode === 'poll') {
      const cleaned = pollOptions.map(o => o.trim()).filter(Boolean)
      if (!content.trim()) { toast.error(t('poll_question_required')); return }
      if (cleaned.length < 2) { toast.error(t('poll_min_options')); return }
    } else {
      if (!content.trim() && !mediaUrl) return
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('posts').insert({
        user_id: userId,
        content: content.trim(),
        media_url: mediaUrl,
        media_type: mediaType,
        type: mode,
      }).select('*, profiles:user_id(id, full_name, email, avatar_url, title)').single()

    if (error) { toast.error(error.message); setSaving(false); return }

    const newPost = data as PostWithAuthor

    if (mode === 'poll') {
      const cleaned = pollOptions.map(o => o.trim()).filter(Boolean)
      const rows = cleaned.map((label, position) => ({ post_id: newPost.id, label, position }))
      const { data: optsData, error: optsErr } = await supabase
        .from('post_poll_options').insert(rows).select('*')
      if (optsErr) {
        toast.error(optsErr.message)
        await supabase.from('posts').delete().eq('id', newPost.id)
        setSaving(false)
        return
      }
      newPost.poll_options = (optsData as PostPollOption[]) || []
    }

    onPosted(newPost)
    setContent('')
    setMediaUrl(null)
    setMediaType(null)
    setPollOptions(['', ''])
    setMode('normal')
    toast.success(t('post_published'))
    setSaving(false)

    // Fire-and-forget email broadcast. We don't await — the user already
    // saw their post appear and shouldn't wait on SMTP.
    fetch('/api/email/post-created', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: newPost.id }),
    }).catch(() => {})
  }

  const canSubmit = !saving && (
    mode === 'poll'
      ? content.trim().length > 0 && pollOptions.filter(o => o.trim()).length >= 2
      : content.trim().length > 0 || !!mediaUrl
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-gray-50 rounded-lg mb-3 w-fit">
        <button
          type="button"
          onClick={() => setMode('normal')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors ${
            mode === 'normal' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />{t('post_mode_normal')}
        </button>
        <button
          type="button"
          onClick={() => setMode('poll')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors ${
            mode === 'poll' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />{t('post_mode_poll')}
        </button>
      </div>

      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
          {userAvatar
            ? <img src={userAvatar} alt="" className="w-full h-full object-cover" />
            : <span className="text-sm font-bold text-gray-500">{(userName || 'U')[0].toUpperCase()}</span>}
        </div>
        <div className="flex-1">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={mode === 'poll' ? t('poll_question_ph') : t('post_composer_ph')}
            rows={mode === 'poll' ? 2 : 3}
            className="w-full resize-none border-0 focus:outline-none text-sm text-gray-900 placeholder:text-gray-400 bg-transparent"
          />

          {mode === 'poll' && (
            <div className="space-y-2 mb-3">
              {pollOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0" />
                  <input
                    type="text"
                    value={opt}
                    onChange={e => setOption(idx, e.target.value)}
                    placeholder={`${t('poll_option')} ${idx + 1}`}
                    className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    ><X className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              {pollOptions.length < 10 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1 ms-7"
                >
                  <Plus className="w-3.5 h-3.5" />{t('poll_add_option')}
                </button>
              )}
            </div>
          )}

          {mediaUrl && (
            <div className="relative rounded-lg overflow-hidden mb-3 bg-gray-50">
              {mediaType === 'video'
                ? <video src={mediaUrl} controls className="w-full max-h-80 object-contain" />
                : <img src={mediaUrl} alt="" className="w-full max-h-80 object-contain" />}
              <button
                onClick={() => { setMediaUrl(null); setMediaType(null) }}
                className="absolute top-2 end-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
              ><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploading}
                className="p-2 rounded-md text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                title={t('post_add_image')}
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                disabled={uploading}
                className="p-2 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                title={t('post_add_video')}
              >
                <Video className="w-4 h-4" />
              </button>
              {uploading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 ms-1" />}
            </div>
            <button
              onClick={publish}
              disabled={!canSubmit}
              className="px-4 py-1.5 rounded-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-200 dark:bg-blue-600/85 dark:hover:bg-blue-500/90 dark:disabled:bg-blue-900/40 text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {t('post_publish')}
            </button>
          </div>
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f, 'image'); e.target.value = '' }} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f, 'video'); e.target.value = '' }} />
    </div>
  )
}
