'use client'

import { useState } from 'react'
import { ChevronUp, ChevronDown, CheckCircle2, XCircle, Trash2, Crown, Award, MoreVertical, RotateCcw } from 'lucide-react'
import type { Profile, Idea } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TimeAgo } from '@/components/ui/time-ago'

type IdeaWithAuthor = Idea & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  departments?: { id: string; name: string } | null
}

interface Props {
  idea: IdeaWithAuthor
  likeCount: number
  dislikeCount: number
  liked: boolean
  disliked: boolean
  currentUserId: string
  isSuperAdmin: boolean
  onLike: () => void
  onDislike: () => void
  onDelete: () => void
  onImplement: (points: number, notes: string) => void
  onReject: () => void
  onReopen: () => void
}

export function IdeaCard({ idea, likeCount, dislikeCount, liked, disliked, currentUserId, isSuperAdmin, onLike, onDislike, onDelete, onImplement, onReject, onReopen }: Props) {
  const { t } = useLanguage()
  const [menuOpen, setMenuOpen] = useState(false)
  const [implOpen, setImplOpen] = useState(false)
  const [points, setPoints] = useState('10')
  const [notes, setNotes] = useState('')

  const isMine = idea.created_by === currentUserId
  const canDelete = isMine || isSuperAdmin
  const isImplemented = idea.status === 'implemented'
  const isRejected = idea.status === 'rejected'

  function submitImplement(e: React.FormEvent) {
    e.preventDefault()
    onImplement(Number(points) || 0, notes.trim())
    setImplOpen(false)
    setPoints('10')
    setNotes('')
  }

  return (
    <article className={`relative bg-white border rounded-2xl p-5 transition-all hover:shadow-sm ${
      isImplemented ? 'border-emerald-200 bg-gradient-to-br from-emerald-50/40 to-white' :
      isRejected ? 'border-gray-100 opacity-70' :
      'border-gray-100'
    }`}>
      <div className="flex gap-4">
        {/* Vote column — like (top) / dislike (bottom) */}
        <div className="flex-shrink-0 flex flex-col items-stretch w-14 rounded-xl overflow-hidden bg-gray-50 border border-gray-100">
          <button
            onClick={onLike}
            disabled={isImplemented || isRejected}
            className={`flex flex-col items-center justify-center py-1.5 transition-colors ${
              liked
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <ChevronUp className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-xs font-bold tabular-nums">{likeCount}</span>
          </button>
          <div className="h-px bg-gray-100" />
          <button
            onClick={onDislike}
            disabled={isImplemented || isRejected}
            className={`flex flex-col items-center justify-center py-1.5 transition-colors ${
              disliked
                ? 'bg-gradient-to-br from-red-500 to-rose-600 text-white'
                : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <span className="text-xs font-bold tabular-nums">{dislikeCount}</span>
            <ChevronDown className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900">{idea.title}</h3>
                {idea.departments ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                    🏢 {idea.departments.name}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                    🌐 {t('idea_general')}
                  </span>
                )}
                {idea.category && (
                  <span className="text-[11px] font-medium bg-gray-50 text-gray-700 px-2 py-0.5 rounded-full">
                    {idea.category}
                  </span>
                )}
                {isImplemented && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />{t('idea_status_implemented')}
                  </span>
                )}
                {isRejected && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3 h-3" />{t('idea_status_rejected')}
                  </span>
                )}
              </div>
              {idea.description && (
                <p className="text-sm text-gray-600 mt-1.5 whitespace-pre-wrap break-words">{idea.description}</p>
              )}
              {isImplemented && idea.implementation_notes && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                  <p className="text-xs font-semibold text-emerald-800 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />{t('idea_implementation_notes')}
                  </p>
                  <p className="text-sm text-emerald-900">{idea.implementation_notes}</p>
                </div>
              )}
              {isImplemented && idea.reward_points > 0 && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">
                  <Award className="w-3.5 h-3.5" />
                  {idea.reward_points} {t('points_awarded')}
                </div>
              )}
            </div>

            {/* Menu */}
            {(canDelete || isSuperAdmin) && (
              <div className="relative">
                <button onClick={() => setMenuOpen(o => !o)} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100">
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute end-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-lg py-1 z-20 min-w-[180px]">
                      {isSuperAdmin && !isImplemented && (
                        <button
                          onClick={() => { setMenuOpen(false); setImplOpen(true) }}
                          className="w-full text-start px-3 py-1.5 text-sm text-emerald-600 hover:bg-emerald-50 flex items-center gap-2"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />{t('idea_mark_implemented')}
                        </button>
                      )}
                      {isSuperAdmin && isImplemented && (
                        <button
                          onClick={() => { setMenuOpen(false); onReopen() }}
                          className="w-full text-start px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />{t('idea_reopen')}
                        </button>
                      )}
                      {isSuperAdmin && !isRejected && !isImplemented && (
                        <button
                          onClick={() => { setMenuOpen(false); onReject() }}
                          className="w-full text-start px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <XCircle className="w-3.5 h-3.5" />{t('idea_reject')}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => { setMenuOpen(false); onDelete() }}
                          className="w-full text-start px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />{t('delete')}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer: author + date */}
          <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
            <div className="w-5 h-5 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              {idea.profiles?.avatar_url
                ? <img src={idea.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-[9px] font-bold text-gray-500">{(idea.profiles?.full_name || idea.profiles?.email || 'U')[0].toUpperCase()}</span>}
            </div>
            <span>{idea.profiles?.full_name || idea.profiles?.email?.split('@')[0] || '—'}</span>
            <span className="text-gray-300">•</span>
            <TimeAgo iso={idea.created_at} />
            {isImplemented && <Crown className="w-3 h-3 text-amber-500 ms-1" />}
          </div>
        </div>
      </div>

      {/* Implement dialog */}
      <Dialog open={implOpen} onOpenChange={setImplOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              {t('idea_mark_implemented')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submitImplement} className="space-y-4 mt-2">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">{t('idea_implementing')}</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{idea.title}</p>
              <p className="text-xs text-gray-500 mt-1">{t('idea_author')}: {idea.profiles?.full_name || idea.profiles?.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('idea_reward_points')}</Label>
              <Input type="number" min="0" value={points} onChange={e => setPoints(e.target.value)} autoFocus />
              <p className="text-xs text-gray-400">{t('idea_reward_hint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('idea_implementation_notes')}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('idea_implementation_notes_ph')} rows={3} />
            </div>
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle2 className="w-4 h-4 mr-2" />{t('confirm')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  )
}

