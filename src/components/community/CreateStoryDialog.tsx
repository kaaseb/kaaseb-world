'use client'

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Check, Type, ImageIcon, Loader2, X, Upload } from 'lucide-react'
import type { Story } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { STORY_GRADIENTS, gradientById } from './gradients'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  onCreated: (story: Story) => void
}

const MAX_CHARS = 280

export function CreateStoryDialog({ open, onOpenChange, userId, onCreated }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [tab, setTab] = useState<'text' | 'media'>('text')
  const [text, setText] = useState('')
  const [bgId, setBgId] = useState(STORY_GRADIENTS[STORY_GRADIENTS.length - 1].id)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setText('')
    setBgId(STORY_GRADIENTS[STORY_GRADIENTS.length - 1].id)
    setMediaUrl(null)
    setMediaType(null)
    setTab('text')
  }

  async function uploadFile(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'stories')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) {
      setMediaUrl(result.url)
      setMediaType(file.type.startsWith('video') ? 'video' : 'image')
    } else {
      toast.error(result.error || 'Upload failed')
    }
    setUploading(false)
  }

  async function publish() {
    const isText = tab === 'text'
    if (isText && !text.trim()) { toast.error(t('story_text_required')); return }
    if (!isText && !mediaUrl) { toast.error(t('story_media_required')); return }

    setSaving(true)
    const payload = isText
      ? { user_id: userId, type: 'text', text_content: text.trim(), bg_color: bgId, media_url: null }
      : { user_id: userId, type: mediaType!, text_content: null, bg_color: null, media_url: mediaUrl }

    const { data, error } = await supabase
      .from('stories').insert(payload).select('*').single()

    if (error) toast.error(error.message)
    else {
      onCreated(data as Story)
      toast.success(t('story_published'))
      reset()
      onOpenChange(false)
      // Fire-and-forget broadcast email to the rest of the team.
      fetch('/api/email/story-created', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: (data as Story).id }),
      }).catch(() => {})
    }
    setSaving(false)
  }

  const canSubmit = (tab === 'text' ? text.trim().length > 0 : !!mediaUrl) && !saving

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('story_create')}</DialogTitle></DialogHeader>

        <div className="flex border-b border-gray-100 mt-2">
          <button
            onClick={() => setTab('text')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
              tab === 'text' ? 'text-blue-600 border-b-2 border-blue-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Type className="w-4 h-4" />{t('story_text')}
          </button>
          <button
            onClick={() => setTab('media')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
              tab === 'media' ? 'text-blue-600 border-b-2 border-blue-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <ImageIcon className="w-4 h-4" />{t('story_media')}
          </button>
        </div>

        {tab === 'text' ? (
          <div className="space-y-4">
            <div
              className="rounded-xl p-10 min-h-48 flex items-center justify-center text-center text-white font-bold text-xl shadow-inner"
              style={{ background: gradientById(bgId) }}
            >
              {text || <span className="opacity-70">{t('story_text_ph_display')}</span>}
            </div>
            <div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
                placeholder={t('story_text_ph')}
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
              />
              <div className="text-xs text-gray-400 mt-1">{text.length}/{MAX_CHARS}</div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">{t('story_bg_color')}</p>
              <div className="flex flex-wrap gap-2">
                {STORY_GRADIENTS.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setBgId(g.id)}
                    className={`w-10 h-10 rounded-full ring-2 transition-all ${bgId === g.id ? 'ring-blue-500 ring-offset-2' : 'ring-transparent'}`}
                    style={{ background: g.css }}
                    aria-label={g.id}
                  >
                    {bgId === g.id && <Check className="w-4 h-4 text-white mx-auto" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {mediaUrl ? (
              <div className="relative rounded-xl overflow-hidden bg-gray-100">
                {mediaType === 'video' ? (
                  <video src={mediaUrl} controls className="w-full max-h-96 object-contain" />
                ) : (
                  <img src={mediaUrl} alt="" className="w-full max-h-96 object-contain" />
                )}
                <button
                  type="button"
                  onClick={() => { setMediaUrl(null); setMediaType(null) }}
                  className="absolute top-2 end-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full rounded-xl border-2 border-dashed border-gray-200 hover:border-gray-300 p-12 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {uploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
                <span className="text-sm">{t('story_upload_hint')}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f)
                e.target.value = ''
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <button type="button" onClick={() => onOpenChange(false)} className="text-sm text-gray-500 hover:text-gray-700">
            {t('cancel')}
          </button>
          <Button onClick={publish} disabled={!canSubmit}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('story_publish')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
