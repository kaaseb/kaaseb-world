import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CommunityDashboard } from '@/components/community/CommunityDashboard'
import type { Profile, Story, Post, PostPollOption } from '@/types'
import { BADGES } from '@/lib/badges'

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

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Profile may be missing in two transient states:
  //   1) DB schema hasn't been applied yet (SetupBanner explains).
  //   2) User signed up *before* the profiles trigger was installed.
  // Don't redirect to /login in either case — middleware would bounce the
  // already-authenticated user straight back to /dashboard, producing the
  // refresh-loop the user reported. Render with a minimal fallback so the
  // SetupBanner from the layout can show, and skip the rest of the data
  // queries (they'd all fail anyway).
  let profile: Profile | null = null
  try {
    const res = await supabase.from('profiles').select('*').eq('id', user.id).single()
    profile = (res.data as Profile | null) ?? null
  } catch { /* table missing — fall back below */ }

  if (!profile) {
    profile = {
      id: user.id,
      email: user.email || '',
      full_name: 'Setup Required',
      avatar_url: null,
      role: 'employee',
      bio: null,
      title: null,
      language: 'ar',
      total_points: 0,
      lock_password_hash: null,
      lock_enabled: false,
      off_days: [],
      custom_role_id: null,
      is_department_manager: false,
      scope: 'both',
      must_change_password: false,
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  let stories: StoryWithAuthor[] = []
  let posts: PostWithAuthor[] = []
  let myLikes: { post_id: string }[] = []
  let likeRows: { post_id: string }[] = []
  let commentRows: { post_id: string }[] = []
  let myStoryViews: { story_id: string }[] = []
  let pollOptionRows: PostPollOption[] = []
  let pollVoteRows: PollVoteRow[] = []
  let taskStats = { totalTasks: 0, completedTasks: 0, pendingTasks: 0, overdueTasks: 0 }
  let latestBadge: { key: string; emoji: string; label_en: string; label_ar: string } | null = null

  // ── Stage 1: independent queries that can fan out in parallel ──────────────
  // Everything here either filters by user.id, by a fixed status, or has no
  // dependency on the post list. The expensive "fetch ALL post_likes / ALL
  // post_comments" patterns are gone — they were O(table size) and would
  // degrade as the platform grew. Like/comment counts are now bounded to the
  // 50 posts we actually display (see Stage 2).
  try {
    const [
      storiesRes, postsRes, myLikesRes, myViewsRes,
      tasksTotalRes, tasksDoneRes, latestBadgeRes,
    ] = await Promise.all([
      supabase
        .from('stories')
        .select('*, profiles:user_id(id, full_name, email, avatar_url, title)')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('posts')
        .select('*, profiles:user_id(id, full_name, email, avatar_url, title)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('post_likes').select('post_id').eq('user_id', user.id),
      supabase.from('story_views').select('story_id').eq('user_id', user.id),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('assigned_user_id', user.id),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('assigned_user_id', user.id).eq('status', 'done'),
      supabase
        .from('user_badges')
        .select('badge_key, earned_at')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    stories = (storiesRes.data || []) as unknown as StoryWithAuthor[]
    posts = (postsRes.data || []) as unknown as PostWithAuthor[]
    myLikes = (myLikesRes.data || []) as typeof myLikes
    myStoryViews = (myViewsRes.data || []) as typeof myStoryViews

    const total = tasksTotalRes.count || 0
    const done = tasksDoneRes.count || 0
    taskStats = {
      totalTasks: total,
      completedTasks: done,
      pendingTasks: Math.max(0, total - done),
      overdueTasks: 0,
    }

    if (latestBadgeRes.data) {
      const def = BADGES.find(b => b.key === latestBadgeRes.data!.badge_key)
      if (def) latestBadge = { key: def.key, emoji: def.emoji, label_en: def.label_en, label_ar: def.label_ar }
    }
  } catch { /* tables may not exist yet — render with defaults */ }

  // ── Stage 2: queries that depend on the post list ──────────────────────────
  // Counts and poll data are scoped to the posts we'll actually render. If
  // there are no posts we skip the network calls entirely.
  try {
    const postIds = posts.map(p => p.id)
    const pollPostIds = posts.filter(p => p.type === 'poll').map(p => p.id)

    if (postIds.length > 0) {
      const [likesRes, commentsRes, pollOptsRes, pollVotesRes] = await Promise.all([
        supabase.from('post_likes').select('post_id').in('post_id', postIds),
        supabase.from('post_comments').select('post_id').in('post_id', postIds),
        pollPostIds.length > 0
          ? supabase.from('post_poll_options').select('*').in('post_id', pollPostIds).order('position')
          : Promise.resolve({ data: [] as PostPollOption[] }),
        pollPostIds.length > 0
          ? supabase
              .from('post_poll_votes')
              .select('post_id, option_id, user_id, profiles:user_id(id, full_name, email, avatar_url)')
              .in('post_id', pollPostIds)
          : Promise.resolve({ data: [] as PollVoteRow[] }),
      ])
      likeRows = (likesRes.data || []) as typeof likeRows
      commentRows = (commentsRes.data || []) as typeof commentRows
      pollOptionRows = (pollOptsRes.data || []) as PostPollOption[]
      pollVoteRows = (pollVotesRes.data || []) as unknown as PollVoteRow[]
    }
  } catch { /* dependent tables may not exist yet */ }

  const likedPostIds = myLikes.map(l => l.post_id)
  const likeCounts: Record<string, number> = {}
  for (const r of likeRows) likeCounts[r.post_id] = (likeCounts[r.post_id] || 0) + 1
  const commentCounts: Record<string, number> = {}
  for (const r of commentRows) commentCounts[r.post_id] = (commentCounts[r.post_id] || 0) + 1

  const pollOptionsByPost: Record<string, PostPollOption[]> = {}
  for (const o of pollOptionRows) {
    (pollOptionsByPost[o.post_id] ||= []).push(o)
  }
  const pollVotesByPost: Record<string, PollVoteRow[]> = {}
  for (const v of pollVoteRows) {
    (pollVotesByPost[v.post_id] ||= []).push(v)
  }
  const enrichedPosts: PostWithAuthor[] = posts.map(p => ({
    ...p,
    poll_options: pollOptionsByPost[p.id] || undefined,
  }))

  const viewedStoryIds = myStoryViews.map(v => v.story_id)

  return (
    <CommunityDashboard
      profile={profile}
      initStories={stories}
      initPosts={enrichedPosts}
      likedPostIds={likedPostIds}
      likeCounts={likeCounts}
      commentCounts={commentCounts}
      pollVotesByPost={pollVotesByPost}
      viewedStoryIds={viewedStoryIds}
      stats={taskStats}
      latestBadge={latestBadge}
    />
  )
}
