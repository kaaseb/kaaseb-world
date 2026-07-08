'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Send, ImageIcon, Paperclip, Loader2, X, FileText } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  onSend: (content: string, mediaUrl: string | null, mediaType: 'image' | 'video' | 'file' | null) => Promise<void>
}

export function MessageComposer({ onSend }: Props) {
  const { t } = useLanguage()
  const [content, setContent] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'file' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File, type: 'image' | 'file') {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'chat')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) {
      setMediaUrl(result.url)
      setMediaType(type === 'image'
        ? (file.type.startsWith('video') ? 'video' : 'image')
        : 'file')
    } else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  async function send() {
    if (!content.trim() && !mediaUrl) return
    setSending(true)
    await onSend(content, mediaUrl, mediaType)
    setContent('')
    setMediaUrl(null)
    setMediaType(null)
    setSending(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="border-t border-gray-100 bg-white/80 backdrop-blur p-3">
      {mediaUrl && (
        <div className="mb-2 inline-flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg p-1.5 pe-3">
          {mediaType === 'image' && <img src={mediaUrl} alt="" className="w-10 h-10 rounded object-cover" />}
          {mediaType === 'video' && <video src={mediaUrl} className="w-10 h-10 rounded object-cover" />}
          {mediaType === 'file' && <FileText className="w-10 h-10 p-2 text-gray-500 bg-white rounded" />}
          <span className="text-xs text-gray-600 max-w-[180px] truncate">{mediaUrl.split('/').pop()}</span>
          <button onClick={() => { setMediaUrl(null); setMediaType(null) }} className="text-gray-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 bg-gray-50 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-blue-200">
        <button
          onClick={() => imageRef.current?.click()}
          disabled={uploading}
          className="p-2 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          aria-label={t('chat_attach_image')}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="p-2 rounded-full text-gray-500 hover:text-purple-600 hover:bg-purple-50 transition-colors"
          aria-label={t('chat_attach_file')}
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat_type_message')}
          rows={1}
          className="flex-1 resize-none bg-transparent border-0 focus:outline-none text-sm py-2 max-h-32"
          style={{ minHeight: '36px' }}
        />
        <button
          onClick={send}
          disabled={sending || (!content.trim() && !mediaUrl)}
          className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-md transition-all"
          aria-label={t('chat_send')}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <input ref={imageRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, 'image'); e.target.value = '' }} />
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, 'file'); e.target.value = '' }} />
    </div>
  )
}
