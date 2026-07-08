'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Heart, MessageCircle, MoreVertical, Trash2, Send, ImageIcon, Paperclip, FileText, X, Loader2 } from 'lucide-react'
import type { Post, Profile, PostComment, PostPollOption } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeAgo } from '@/components/ui/time-ago'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PostPoll } from './PostPoll'

type PostWithAuthor = Post & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
  poll_options?: PostPollOption[]
}

type PollVoteRow = {
  option_id: string
  user_id: string
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
}

interface Props {
  post: PostWithAuthor
  currentUserId: string
  isSuperAdmin?: boolean
  initLiked: boolean
  initLikeCount: number
  initCommentCount: number
  initPollVotes?: PollVoteRow[]
  onDelete: (id: string) => void
}

type CommentWithAuthor = PostComment & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
  media_url?: string | null
  media_type?: 'image' | 'video' | 'file' | null
}

export function PostCard({ post, currentUserId, isSuperAdmin, initLiked, initLikeCount, initCommentCount, initPollVotes, onDelete }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [liked, setLiked] = useState(initLiked)
  const [likeCount, setLikeCount] = useState(initLikeCount)
  const [commentCount, setCommentCount] = useState(initCommentCount)
  const [menuOpen, setMenuOpen] = useState(false)
  const [likersOpen, setLikersOpen] = useState(false)
  const [likers, setLikers] = useState<Array<{ user_id: string; profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null }>>([])
  const [loadingLikers, setLoadingLikers] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<CommentWithAuthor[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentMediaUrl, setCommentMediaUrl] = useState<string | null>(null)
  const [commentMediaType, setCommentMediaType] = useState<'image' | 'video' | 'file' | null>(null)
  const [posting, setPosting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const imgRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function toggleLike() {
    const nowLiked = !liked
    setLiked(nowLiked)
    setLikeCount(c => c + (nowLiked ? 1 : -1))
    if (nowLiked) {
      const { error } = await supabase.from('post_likes').insert({ post_id: post.id, user_id: currentUserId })
      if (error) { setLiked(false); setLikeCount(c => c - 1); toast.error(error.message) }
    } else {
      const { error } = await supabase.from('post_likes').delete().eq('post_id', post.id).eq('user_id', currentUserId)
      if (error) { setLiked(true); setLikeCount(c => c + 1); toast.error(error.message) }
    }
  }

  async function loadLikers() {
    setLikersOpen(true)
    setLoadingLikers(true)
    const { data } = await supabase
      .from('post_likes')
      .select('user_id, profiles(id, full_name, email, avatar_url)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: false })
    setLikers(((data as unknown) as typeof likers) || [])
    setLoadingLikers(false)
  }

  async function loadComments() {
    setCommentsOpen(true)
    setLoadingComments(true)
    const { data } = await supabase
      .from('post_comments')
      .select('*, profiles:user_id(id, full_name, email, avatar_url, title)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: true })
    setComments((data as CommentWithAuthor[]) || [])
    setLoadingComments(false)
  }

  async function uploadCommentMedia(file: File, kind: 'image' | 'file') {
    setUploading(true)
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'posts')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) {
      setCommentMediaUrl(result.url)
      setCommentMediaType(kind === 'image' ? (file.type.startsWith('video') ? 'video' : 'image') : 'file')
    } else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  async function postComment() {
    if (!commentText.trim() && !commentMediaUrl) return
    setPosting(true)
    const { data, error } = await supabase
      .from('post_comments')
      .insert({
        post_id: post.id,
        user_id: currentUserId,
        content: commentText.trim() || '',
        media_url: commentMediaUrl,
        media_type: commentMediaType,
      })
      .select('*, profiles:user_id(id, full_name, email, avatar_url, title)')
      .single()
    if (error) toast.error(error.message)
    else {
      setComments(prev => [...prev, data as CommentWithAuthor])
      setCommentCount(c => c + 1)
      setCommentText('')
      setCommentMediaUrl(null)
      setCommentMediaType(null)
    }
    setPosting(false)
  }

  async function deleteComment(id: string) {
    if (!confirm(t('confirm_delete'))) return
    const { error } = await supabase.from('post_comments').delete().eq('id', id)
    if (error) toast.error(error.message)
    else {
      setComments(prev => prev.filter(c => c.id !== id))
      setCommentCount(c => Math.max(0, c - 1))
    }
  }

  async function handleDelete() {
    if (!confirm(t('post_delete_confirm'))) return
    const { error } = await supabase.from('posts').delete().eq('id', post.id)
    if (error) toast.error(error.message)
    else { onDelete(post.id); toast.success(t('deleted')) }
  }

  const isMine = post.user_id === currentUserId
  const canManagePost = isMine || isSuperAdmin
  const canManageComment = (c: { user_id: string }) => c.user_id === currentUserId || isSuperAdmin

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
            {post.profiles?.avatar_url
              ? <img src={post.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-sm font-bold text-gray-500">{(post.profiles?.full_name || post.profiles?.email || 'U')[0].toUpperCase()}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{post.profiles?.full_name || post.profiles?.email?.split('@')[0]}</p>
            {post.profiles?.title && (
              <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-500/12 dark:to-yellow-500/8 border border-amber-100 dark:border-amber-400/25 rounded-full px-2 py-0.5">
                💪 <span>{post.profiles.title}</span>
              </span>
            )}
            <TimeAgo iso={post.created_at} className="text-[11px] text-gray-400 mt-0.5 block" />
          </div>
          {canManagePost && (
            <div className="relative">
              <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100">
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute end-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg py-1 z-10 min-w-[140px]">
                  <button
                    onClick={() => { setMenuOpen(false); handleDelete() }}
                    className="w-full text-start px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />{t('delete')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {post.content && <p className="text-sm text-gray-800 mt-3 whitespace-pre-wrap break-words">{post.content}</p>}
      </div>

      {post.media_url && (
        <div className="bg-gray-50">
          {post.media_type === 'video'
            ? <video src={post.media_url} controls className="w-full max-h-[500px] object-contain" />
            : <img src={post.media_url} alt="" className="w-full max-h-[500px] object-contain" />}
        </div>
      )}

      {post.type === 'poll' && post.poll_options && post.poll_options.length > 0 && (
        <PostPoll
          postId={post.id}
          options={post.poll_options}
          initVotes={initPollVotes || []}
          currentUserId={currentUserId}
        />
      )}

      <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100">
        <button
          onClick={toggleLike}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
            liked ? 'text-red-600' : 'text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
          <span>{t('post_like')}</span>
        </button>
        {likeCount > 0 && (
          <button onClick={loadLikers} className="text-xs text-gray-500 hover:text-blue-600 hover:underline">
            {likeCount} {t('post_likers_label')}
          </button>
        )}
        <button
          onClick={loadComments}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 rounded-md transition-colors ms-auto"
        >
          <MessageCircle className="w-4 h-4" />
          {commentCount > 0 ? commentCount : ''} {t('post_comment')}
        </button>
      </div>

      {/* Likers dialog */}
      <Dialog open={likersOpen} onOpenChange={setLikersOpen}>
        <DialogContent className="sm:max-w-sm max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('post_likers_title')}</DialogTitle></DialogHeader>
          {loadingLikers ? (
            <div className="text-center text-sm text-gray-400 py-6">…</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {likers.map(l => (
                <li key={l.user_id} className="py-2 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                    {l.profiles?.avatar_url
                      ? <img src={l.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[10px] font-bold text-gray-500">{(l.profiles?.full_name || l.profiles?.email || 'U')[0].toUpperCase()}</span>}
                  </div>
                  <p className="text-sm font-medium text-gray-900 truncate">{l.profiles?.full_name || l.profiles?.email}</p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Comments dialog */}
      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>{t('post_comments_title')}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 mt-2">
            {loadingComments ? (
              <div className="text-center text-sm text-gray-400 py-6">…</div>
            ) : comments.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">{t('post_no_comments')}</p>
            ) : comments.map(c => (
              <div key={c.id} className="flex gap-2 group">
                <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                  {c.profiles?.avatar_url
                    ? <img src={c.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-[10px] font-bold text-gray-500 flex items-center justify-center w-full h-full">{(c.profiles?.full_name || c.profiles?.email || 'U')[0].toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="bg-gray-50 rounded-2xl rounded-ss-md px-3 py-2">
                    <p className="text-xs font-semibold text-gray-900">{c.profiles?.full_name || c.profiles?.email?.split('@')[0]}</p>
                    {c.content && <p className="text-sm text-gray-800 whitespace-pre-wrap break-words mt-0.5">{c.content}</p>}
                    {c.media_url && c.media_type === 'image' && (
                      <img src={c.media_url} alt="" className="mt-2 max-w-[280px] rounded-lg" />
                    )}
                    {c.media_url && c.media_type === 'video' && (
                      <video src={c.media_url} controls className="mt-2 max-w-[280px] rounded-lg" />
                    )}
                    {c.media_url && c.media_type === 'file' && (
                      <a href={c.media_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-600 underline">
                        <FileText className="w-3.5 h-3.5" />{c.media_url.split('/').pop()}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 ms-2">
                    <TimeAgo iso={c.created_at} className="text-[10px] text-gray-400" />
                    {canManageComment(c) && (
                      <button onClick={() => deleteComment(c.id)} className="text-[10px] text-gray-400 hover:text-red-500">
                        {t('delete')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          {commentMediaUrl && (
            <div className="mb-2 inline-flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg p-1.5 pe-3">
              {commentMediaType === 'image' && <img src={commentMediaUrl} alt="" className="w-10 h-10 rounded object-cover" />}
              {commentMediaType === 'video' && <video src={commentMediaUrl} className="w-10 h-10 rounded object-cover" />}
              {commentMediaType === 'file' && <FileText className="w-10 h-10 p-2 text-gray-500" />}
              <span className="text-xs text-gray-600 max-w-[180px] truncate">{commentMediaUrl.split('/').pop()}</span>
              <button onClick={() => { setCommentMediaUrl(null); setCommentMediaType(null) }} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
            </div>
          )}
          <div className="flex items-end gap-2 bg-gray-50 rounded-2xl p-1.5 mt-2">
            <button onClick={() => imgRef.current?.click()} disabled={uploading} className="p-2 rounded-full text-gray-500 hover:text-blue-600 hover:bg-blue-50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="p-2 rounded-full text-gray-500 hover:text-purple-600 hover:bg-purple-50">
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder={t('post_reply_ph')}
              rows={1}
              className="flex-1 resize-none bg-transparent border-0 focus:outline-none text-sm py-2 max-h-32"
              style={{ minHeight: '32px' }}
            />
            <button
              onClick={postComment}
              disabled={posting || (!commentText.trim() && !commentMediaUrl)}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center disabled:opacity-40"
            >
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <input ref={imgRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCommentMedia(f, 'image'); e.target.value = '' }} />
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCommentMedia(f, 'file'); e.target.value = '' }} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

