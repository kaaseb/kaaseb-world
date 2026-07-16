'use client'

import { useState, useEffect } from 'react'
import type { Profile, Story, Post, PostPollOption } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { ScoutSummary, type ScoutStats } from '@/components/dashboard/ScoutSummary'
import { StoriesRow } from './StoriesRow'
import { PostComposer } from './PostComposer'
import { PostCard } from './PostCard'
import { PresenceList } from '@/components/presence/PresenceList'
import { CheckCircle2, ListTodo, Clock, AlertTriangle, Sparkles } from 'lucide-react'

type StoryWithAuthor = Story & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
}
type PostWithAuthor = Post & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'title'> | null
  poll_options?: PostPollOption[]
}
type PollVoteRow = {
  post_id: string
  option_id: string
  user_id: string
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
}

interface Props {
  profile: Profile
  initStories: StoryWithAuthor[]
  initPosts: PostWithAuthor[]
  likedPostIds: string[]
  likeCounts: Record<string, number>
  commentCounts: Record<string, number>
  pollVotesByPost: Record<string, PollVoteRow[]>
  viewedStoryIds: string[]
  latestBadge: { key: string; emoji: string; label_en: string; label_ar: string } | null
  stats: {
    totalTasks: number
    completedTasks: number
    overdueTasks: number
    pendingTasks: number
  }
  scoutStats: ScoutStats
  canOpp: boolean
  canCompanies: boolean
}

export function CommunityDashboard({
  profile, initStories, initPosts, likedPostIds, likeCounts, commentCounts, pollVotesByPost, viewedStoryIds, latestBadge, stats,
  scoutStats, canOpp, canCompanies,
}: Props) {
  const { t, isRtl } = useLanguage()
  const [stories, setStories] = useState(initStories)
  const [posts, setPosts] = useState(initPosts)
  const [viewedSet, setViewedSet] = useState<Set<string>>(() => new Set(viewedStoryIds))

  const firstName = (profile.full_name || profile.email.split('@')[0] || '').split(' ')[0]
  const isSuperAdmin = profile.role === 'super_admin'

  // Greeting based on the user's local clock — AM = morning, PM = evening.
  // Computed in useEffect to avoid SSR/client hydration mismatch.
  const [greeting, setGreeting] = useState<string>(t('community_welcome'))
  useEffect(() => {
    const hour = new Date().getHours()
    setGreeting(hour < 12 ? t('dashboard_good_morning') : t('dashboard_good_afternoon'))
  }, [t])

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* What the robot found while you slept — first thing on the page, because
          a scout nobody opens is a scout that doesn't exist. */}
      <ScoutSummary stats={scoutStats} canOpp={canOpp} canCompanies={canCompanies} />

      {/* Hero */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900" suppressHydrationWarning>
              {greeting} {firstName}
            </h1>
            {profile.title && (
              <span className="group relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-amber-100 via-orange-100 to-amber-100 dark:from-amber-500/15 dark:via-orange-500/15 dark:to-amber-500/15 border border-amber-200/80 dark:border-amber-400/25 shadow-sm dark:shadow-none hover:shadow-md transition-shadow text-xs font-bold text-amber-800 dark:text-amber-300">
                <span className="text-base leading-none drop-shadow-sm">💪</span>
                <span>{profile.title}</span>
                <span className="absolute -inset-px rounded-full bg-gradient-to-r from-amber-300/0 via-amber-300/30 to-amber-300/0 opacity-0 group-hover:opacity-100 blur-sm transition-opacity pointer-events-none" />
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{t('community_tagline')}</p>
        </div>
        {latestBadge ? (
          <div className="flex-shrink-0 flex flex-col items-center text-center group">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-500/12 dark:to-amber-500/6 border border-amber-200 dark:border-amber-400/25 flex items-center justify-center text-3xl shadow-sm dark:shadow-none transition-transform group-hover:scale-105">
              {latestBadge.emoji}
            </div>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 max-w-[120px] truncate">
              <Sparkles className="w-3 h-3" />
              {isRtl ? latestBadge.label_ar : latestBadge.label_en}
            </span>
          </div>
        ) : (
          <div className="flex-shrink-0 flex flex-col items-center text-center opacity-60">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-white/5 border border-dashed border-gray-200 dark:border-white/15 flex items-center justify-center text-2xl grayscale">
              🌱
            </div>
            <span className="mt-1 text-[11px] font-medium text-gray-400 max-w-[120px] truncate">
              {t('badges_none_yet')}
            </span>
          </div>
        )}
      </div>

      {/* Stories */}
      <div className="mb-6">
        <StoriesRow
          currentUserId={profile.id}
          isSuperAdmin={isSuperAdmin}
          stories={stories}
          setStories={setStories}
          viewedSet={viewedSet}
          onMarkViewed={(ids) => {
            setViewedSet(prev => {
              const next = new Set(prev)
              for (const id of ids) next.add(id)
              return next
            })
          }}
          currentUserAvatar={profile.avatar_url}
          currentUserName={profile.full_name}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed column */}
        <div className="lg:col-span-2 space-y-4">
          <PostComposer
            userId={profile.id}
            userAvatar={profile.avatar_url}
            userName={profile.full_name}
            onPosted={(p) => setPosts([p, ...posts])}
          />

          {posts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
              <p className="text-gray-400 text-sm">{t('posts_empty')}</p>
            </div>
          ) : (
            posts.map(p => (
              <PostCard
                key={p.id}
                post={p}
                currentUserId={profile.id}
                isSuperAdmin={isSuperAdmin}
                initLiked={likedPostIds.includes(p.id)}
                initLikeCount={likeCounts[p.id] || 0}
                initCommentCount={commentCounts[p.id] || 0}
                initPollVotes={pollVotesByPost[p.id]?.map(v => ({
                  option_id: v.option_id,
                  user_id: v.user_id,
                  profiles: v.profiles,
                }))}
                onDelete={(id) => setPosts(posts.filter(x => x.id !== id))}
              />
            ))
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <PresenceList currentUserId={profile.id} />
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span>📊</span>{t('overview')}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<ListTodo className="w-4 h-4 text-blue-600" />}    value={stats.totalTasks}     label={t('stat_total_tasks')}     bg="bg-blue-50" />
              <Stat icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} value={stats.completedTasks} label={t('stat_completed_tasks')} bg="bg-emerald-50" />
              <Stat icon={<Clock className="w-4 h-4 text-amber-600" />}       value={stats.pendingTasks}   label={t('stat_pending_tasks')}   bg="bg-amber-50" />
              <Stat icon={<AlertTriangle className="w-4 h-4 text-red-600" />} value={stats.overdueTasks}   label={t('stat_overdue_tasks')}   bg="bg-red-50" />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">💰 {t('points')}</h3>
            <p className="text-3xl font-bold text-amber-600">{profile.total_points}</p>
            <p className="text-xs text-gray-500 mt-1">{t('dashboard_total_points')}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Stat({ icon, value, label, bg }: { icon: React.ReactNode, value: number, label: string, bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-3`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xl font-bold text-gray-900">{value}</span>
        {icon}
      </div>
      <p className="text-[11px] text-gray-600">{label}</p>
    </div>
  )
}
