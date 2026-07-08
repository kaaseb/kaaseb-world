'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Lightbulb, Plus, Search, TrendingUp, Clock, CheckCircle2, Flame, Sparkles, ThumbsUp } from 'lucide-react'
import type { Profile, Idea } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { NewIdeaDialog } from './NewIdeaDialog'
import { IdeaCard } from './IdeaCard'
import { VoteFeedback } from './VoteFeedback'

type IdeaWithAuthor = Idea & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  departments?: { id: string; name: string } | null
}

type SortKey = 'top' | 'trending' | 'recent' | 'implemented'

interface Props {
  profile: Profile
  initIdeas: IdeaWithAuthor[]
  likeCounts: Record<string, number>
  dislikeCounts: Record<string, number>
  myLikeIds: string[]
  myDislikeIds: string[]
  departments: { id: string; name: string }[]
}

export function IdeaMarketClient({ profile, initIdeas, likeCounts: initLikeCounts, dislikeCounts: initDislikeCounts, myLikeIds, myDislikeIds, departments }: Props) {
  const { t, isRtl } = useLanguage()
  const supabase = createClient()
  const [ideas, setIdeas] = useState(initIdeas)
  const [likeCounts, setLikeCounts] = useState(initLikeCounts)
  const [dislikeCounts, setDislikeCounts] = useState(initDislikeCounts)
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set(myLikeIds))
  const [dislikedSet, setDislikedSet] = useState<Set<string>>(new Set(myDislikeIds))
  const [sort, setSort] = useState<SortKey>('top')
  const [deptFilter, setDeptFilter] = useState<string>('') // '' = all, 'general' = general only, '<id>' = specific dept
  // Stable "now" for trending calc; initialised on client mount to avoid hydration mismatch.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => { setNow(Date.now()) }, [])
  const [category, setCategory] = useState<string>('')
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null)

  const isSuperAdmin = profile.role === 'super_admin'

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const i of ideas) if (i.category) set.add(i.category)
    return Array.from(set).sort()
  }, [ideas])

  const totalVotes = Object.values(likeCounts).reduce((a, b) => a + b, 0)
  const implementedCount = ideas.filter(i => i.status === 'implemented').length

  // Net score for trending/top sort: likes minus dislikes.
  const netScore = (id: string) => (likeCounts[id] || 0) - (dislikeCounts[id] || 0)

  const visible = useMemo(() => {
    let list = ideas
    if (category) list = list.filter(i => i.category === category)
    if (deptFilter) {
      if (deptFilter === 'general') list = list.filter(i => !i.department_id)
      else list = list.filter(i => i.department_id === deptFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    switch (sort) {
      case 'top':
        sorted.sort((a, b) => netScore(b.id) - netScore(a.id))
        break
      case 'trending': {
        if (now == null) {
          // Before mount: fall back to newest-first so SSR & initial client render match.
          sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        } else {
          sorted.sort((a, b) => {
            const scoreA = netScore(a.id) / Math.max(1, (now - new Date(a.created_at).getTime()) / 3_600_000)
            const scoreB = netScore(b.id) / Math.max(1, (now - new Date(b.created_at).getTime()) / 3_600_000)
            return scoreB - scoreA
          })
        }
        break
      }
      case 'recent':
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        break
      case 'implemented':
        return sorted.filter(i => i.status === 'implemented')
          .sort((a, b) => new Date(b.implemented_at || b.created_at).getTime() - new Date(a.implemented_at || a.created_at).getTime())
    }
    return sorted
  }, [ideas, sort, category, deptFilter, search, likeCounts, dislikeCounts, now])

  // Single voting function — value 1 = like, -1 = dislike. Tapping the same
  // direction removes the vote; tapping the other direction switches it.
  async function castVote(ideaId: string, value: 1 | -1) {
    const isLiked = likedSet.has(ideaId)
    const isDisliked = dislikedSet.has(ideaId)
    const same = (value === 1 && isLiked) || (value === -1 && isDisliked)

    // Compute target state
    let nextLikeDelta = 0
    let nextDislikeDelta = 0
    const nextLiked = new Set(likedSet)
    const nextDisliked = new Set(dislikedSet)

    if (same) {
      // Remove vote
      if (value === 1) { nextLiked.delete(ideaId); nextLikeDelta = -1 }
      else            { nextDisliked.delete(ideaId); nextDislikeDelta = -1 }
    } else {
      // Switch or set fresh
      if (value === 1) {
        nextLiked.add(ideaId); nextLikeDelta = 1
        if (isDisliked) { nextDisliked.delete(ideaId); nextDislikeDelta = -1 }
      } else {
        nextDisliked.add(ideaId); nextDislikeDelta = 1
        if (isLiked) { nextLiked.delete(ideaId); nextLikeDelta = -1 }
      }
    }

    // Optimistic apply
    setLikedSet(nextLiked)
    setDislikedSet(nextDisliked)
    setLikeCounts(c => ({ ...c, [ideaId]: Math.max(0, (c[ideaId] || 0) + nextLikeDelta) }))
    setDislikeCounts(c => ({ ...c, [ideaId]: Math.max(0, (c[ideaId] || 0) + nextDislikeDelta) }))

    // Show celebratory / sad feedback on fresh vote or switch (not on unvote)
    if (!same) setFeedback(value === 1 ? 'like' : 'dislike')

    // Persist
    if (same) {
      const { error } = await supabase.from('idea_votes').delete().eq('idea_id', ideaId).eq('user_id', profile.id)
      if (error) toast.error(error.message)
    } else {
      const { error } = await supabase
        .from('idea_votes')
        .upsert({ idea_id: ideaId, user_id: profile.id, value }, { onConflict: 'idea_id,user_id' })
      if (error) toast.error(error.message)
    }
  }

  async function deleteIdea(ideaId: string) {
    if (!confirm(t('confirm_delete'))) return
    const { error } = await supabase.from('ideas').delete().eq('id', ideaId)
    if (error) toast.error(error.message)
    else {
      setIdeas(ideas.filter(i => i.id !== ideaId))
      toast.success(t('deleted'))
    }
  }

  async function markImplemented(idea: IdeaWithAuthor, rewardPoints: number, notes: string) {
    const { data, error } = await supabase
      .from('ideas')
      .update({
        status: 'implemented',
        reward_points: rewardPoints,
        implementation_notes: notes || null,
        implemented_at: new Date().toISOString(),
        implemented_by: profile.id,
      })
      .eq('id', idea.id)
      .select('*, profiles:created_by(id, full_name, email, avatar_url), departments(id, name)')
      .single()
    if (error) { toast.error(error.message); return }

    // Award points to the idea's creator (increment total_points).
    if (idea.created_by && rewardPoints > 0) {
      const { data: currentProfile } = await supabase
        .from('profiles').select('total_points').eq('id', idea.created_by).single()
      const newPoints = (currentProfile?.total_points ?? 0) + rewardPoints
      await supabase.from('profiles').update({ total_points: newPoints }).eq('id', idea.created_by)
    }

    setIdeas(ideas.map(i => i.id === idea.id ? (data as IdeaWithAuthor) : i))
    toast.success(t('idea_marked_implemented'))
  }

  async function rejectIdea(idea: IdeaWithAuthor) {
    if (!confirm(t('idea_reject_confirm'))) return
    const { data, error } = await supabase
      .from('ideas')
      .update({ status: 'rejected' })
      .eq('id', idea.id)
      .select('*, profiles:created_by(id, full_name, email, avatar_url), departments(id, name)')
      .single()
    if (error) toast.error(error.message)
    else {
      setIdeas(ideas.map(i => i.id === idea.id ? (data as IdeaWithAuthor) : i))
      toast.success(t('saved'))
    }
  }

  async function reopenIdea(idea: IdeaWithAuthor) {
    const { data, error } = await supabase
      .from('ideas')
      .update({ status: 'proposed', reward_points: 0, implemented_at: null, implemented_by: null, implementation_notes: null })
      .eq('id', idea.id)
      .select('*, profiles:created_by(id, full_name, email, avatar_url), departments(id, name)')
      .single()
    if (error) toast.error(error.message)
    else {
      setIdeas(ideas.map(i => i.id === idea.id ? (data as IdeaWithAuthor) : i))
      toast.success(t('saved'))
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 p-6 md:p-8 text-white mb-6 relative overflow-hidden">
        <div className="flex flex-col-reverse md:flex-row md:items-start md:justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />{t('idea_submit')}
              </button>
              <Stat icon={<Lightbulb className="w-3.5 h-3.5" />} label={t('ideas_count')} value={ideas.length} />
              <Stat icon={<ThumbsUp className="w-3.5 h-3.5" />} label={t('votes_count')} value={totalVotes} />
              <Stat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label={t('ideas_implemented')} value={implementedCount} />
            </div>
          </div>
          <div className="text-end">
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 justify-end">
              💡 {t('idea_market_title')}
            </h1>
            <p className="text-sm text-white/80 mt-2 max-w-md ms-auto">{t('idea_market_subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />{t('idea_new')}
        </button>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('idea_search_ph')}
            className="w-full h-10 ps-9 pe-3 rounded-lg border border-gray-200 focus:border-blue-400 text-sm outline-none bg-white"
          />
        </div>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="h-10 rounded-lg border border-gray-200 px-3 text-sm bg-white"
        >
          <option value="">{t('all_categories')}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="h-10 rounded-lg border border-gray-200 px-3 text-sm bg-white"
        >
          <option value="">{t('idea_all_departments')}</option>
          <option value="general">{t('idea_general')}</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <div className="flex items-center gap-1 ms-auto">
          <SortPill active={sort === 'top'}         icon={<TrendingUp className="w-3.5 h-3.5" />} label={t('idea_sort_top')}         onClick={() => setSort('top')} />
          <SortPill active={sort === 'trending'}    icon={<Flame className="w-3.5 h-3.5 text-orange-500" />} label={t('idea_sort_trending')}    onClick={() => setSort('trending')} />
          <SortPill active={sort === 'recent'}      icon={<Clock className="w-3.5 h-3.5" />}      label={t('idea_sort_recent')}      onClick={() => setSort('recent')} />
          <SortPill active={sort === 'implemented'} icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />} label={t('idea_sort_implemented')} onClick={() => setSort('implemented')} />
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="border border-dashed border-gray-200 rounded-2xl py-20 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-50 flex items-center justify-center">
            <Lightbulb className="w-7 h-7 text-blue-500" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">{t('ideas_empty_title')}</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{t('ideas_empty_hint')}</p>
          <button
            onClick={() => setNewOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />{t('idea_submit_first')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(i => (
            <IdeaCard
              key={i.id}
              idea={i}
              likeCount={likeCounts[i.id] || 0}
              dislikeCount={dislikeCounts[i.id] || 0}
              liked={likedSet.has(i.id)}
              disliked={dislikedSet.has(i.id)}
              currentUserId={profile.id}
              isSuperAdmin={isSuperAdmin}
              onLike={() => castVote(i.id, 1)}
              onDislike={() => castVote(i.id, -1)}
              onDelete={() => deleteIdea(i.id)}
              onImplement={(pts, notes) => markImplemented(i, pts, notes)}
              onReject={() => rejectIdea(i)}
              onReopen={() => reopenIdea(i)}
            />
          ))}
        </div>
      )}

      <NewIdeaDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        userId={profile.id}
        existingCategories={categories}
        departments={departments}
        onCreated={(idea) => setIdeas([idea, ...ideas])}
      />

      <VoteFeedback variant={feedback} onClose={() => setFeedback(null)} />
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode, label: string, value: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-xs font-medium">
      {icon}
      <span>{value}</span>
      <span className="opacity-80">{label}</span>
    </div>
  )
}

function SortPill({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-600 hover:bg-gray-50 border border-transparent'
      }`}
    >
      {icon}{label}
    </button>
  )
}
