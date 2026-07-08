'use client'

import { FileText, MoreVertical, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ChatMessage } from '@/types'

interface Props {
  message: ChatMessage
  isMine: boolean
  authorName: string
  authorAvatar: string | null
  showAuthor: boolean
  showAvatar: boolean
  onDelete?: () => void
}

export function MessageBubble({ message, isMine, authorName, authorAvatar, showAuthor, showAvatar, onDelete }: Props) {
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
      {!isMine && (
        <div className="w-7 flex-shrink-0">
          {showAvatar && (
            <div className="w-7 h-7 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
              {authorAvatar
                ? <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
                : <span className="text-[10px] font-bold text-gray-500">{authorName[0]?.toUpperCase()}</span>}
            </div>
          )}
        </div>
      )}
      <div className={`max-w-[70%] flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
        {showAuthor && (
          <span className="text-[11px] font-semibold text-purple-600 mb-0.5 px-1">{authorName}</span>
        )}
        <div
          className={`relative group px-3.5 py-2 rounded-2xl ${
            isMine
              ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
              : 'bg-white border border-gray-100 text-gray-900'
          } ${isMine ? 'rounded-se-md' : 'rounded-ss-md'}`}
        >
          {/* Delete menu (own messages only) */}
          {isMine && onDelete && (
            <div className="absolute -top-2 end-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="w-6 h-6 rounded-full bg-white shadow border border-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900"
                aria-label="message actions"
              >
                <MoreVertical className="w-3 h-3" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute end-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg py-1 z-20 min-w-[120px]">
                    <button
                      onClick={() => { setMenuOpen(false); onDelete() }}
                      className="w-full text-start px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {message.media_url && message.media_type === 'image' && (
            <a href={message.media_url} target="_blank" rel="noreferrer">
              <img src={message.media_url} alt="" className="max-w-[260px] max-h-[320px] rounded-lg object-cover mb-1.5" />
            </a>
          )}
          {message.media_url && message.media_type === 'video' && (
            <video src={message.media_url} controls className="max-w-[260px] max-h-[320px] rounded-lg mb-1.5" />
          )}
          {message.media_url && message.media_type === 'file' && (
            <a
              href={message.media_url}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg mb-1.5 ${
                isMine ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span className="text-xs truncate">{message.media_url.split('/').pop()}</span>
            </a>
          )}
          {message.content && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          )}
          <span className={`block text-[10px] mt-1 ${isMine ? 'text-white/70 text-end' : 'text-gray-400 text-start'}`}>
            {time}{message.edited_at ? ' ·' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
