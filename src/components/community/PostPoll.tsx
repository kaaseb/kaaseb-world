'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { Profile, PostPollOption } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

type Voter = Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>
type VoteRow = { option_id: string; user_id: string; profiles: Voter | null }

interface Props {
  postId: string
  options: PostPollOption[]
  initVotes: VoteRow[]
  currentUserId: string
}

export function PostPoll({ postId, options, initVotes, currentUserId }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [votes, setVotes] = useState<VoteRow[]>(initVotes)
  const [busy, setBusy] = useState(false)

  const myVote = votes.find(v => v.user_id === currentUserId)
  const total = votes.length
  const sortedOptions = [...options].sort((a, b) => a.position - b.position)

  async function castVote(optionId: string) {
    if (busy) return
    const isUnvote = myVote?.option_id === optionId
    setBusy(true)

    if (isUnvote) {
      const prev = votes
      setVotes(v => v.filter(x => x.user_id !== currentUserId))
      const { error } = await supabase
        .from('post_poll_votes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', currentUserId)
      if (error) { setVotes(prev); toast.error(error.message) }
    } else {
      const optimistic: VoteRow = {
        option_id: optionId,
        user_id: currentUserId,
        profiles: votes.find(v => v.user_id === currentUserId)?.profiles ?? null,
      }
      const prev = votes
      setVotes(v => [...v.filter(x => x.user_id !== currentUserId), optimistic])
      const { data, error } = await supabase
        .from('post_poll_votes')
        .upsert(
          { post_id: postId, option_id: optionId, user_id: currentUserId },
          { onConflict: 'post_id,user_id' }
        )
        .select('option_id, user_id, profiles:user_id(id, full_name, email, avatar_url)')
        .single()
      if (error) { setVotes(prev); toast.error(error.message) }
      else if (data) {
        setVotes(v => [
          ...v.filter(x => x.user_id !== currentUserId),
          (data as unknown) as VoteRow,
        ])
      }
    }
    setBusy(false)
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide">
        {t('poll_select_one')} · {total} {total === 1 ? t('poll_vote') : t('poll_votes')}
      </p>
      {sortedOptions.map(opt => {
        const optVotes = votes.filter(v => v.option_id === opt.id)
        const count = optVotes.length
        const pct = total === 0 ? 0 : Math.round((count / total) * 100)
        const isMine = myVote?.option_id === opt.id

        return (
          <button
            key={opt.id}
            onClick={() => castVote(opt.id)}
            disabled={busy}
            className={`relative w-full text-start rounded-xl border transition-all overflow-hidden ${
              isMine ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-100 hover:border-gray-200 bg-white'
            }`}
          >
            <div
              className={`absolute inset-y-0 start-0 transition-all ${
                isMine ? 'bg-emerald-200/40' : 'bg-gray-100/70'
              }`}
              style={{ width: `${pct}%` }}
            />
            <div className="relative flex items-center gap-3 px-3 py-2.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                isMine ? 'bg-emerald-500 text-white' : 'border-2 border-gray-300'
              }`}>
                {isMine && <Check className="w-3 h-3" strokeWidth={3} />}
              </div>
              <span className="flex-1 text-sm font-medium text-gray-900 truncate">{opt.label}</span>
              {count > 0 && (
                <div className="flex -space-x-1 me-1">
                  {optVotes.slice(0, 3).map(v => (
                    <div
                      key={v.user_id}
                      className="w-5 h-5 rounded-full bg-white border border-gray-200 overflow-hidden flex items-center justify-center"
                      title={v.profiles?.full_name || v.profiles?.email || ''}
                    >
                      {v.profiles?.avatar_url
                        ? <img src={v.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-[8px] font-bold text-gray-500">{(v.profiles?.full_name || v.profiles?.email || 'U')[0].toUpperCase()}</span>}
                    </div>
                  ))}
                </div>
              )}
              <span className="text-xs font-bold text-gray-700 tabular-nums w-6 text-end">{count}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
