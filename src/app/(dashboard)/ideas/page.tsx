import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { IdeaMarketClient } from '@/components/ideas/IdeaMarketClient'
import { getProfileOrFallback } from '@/lib/profile'
import type { Profile, Idea } from '@/types'

export default async function IdeasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  let ideas: (Idea & {
    profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
    departments: { id: string; name: string } | null
  })[] = []
  let voteRows: { idea_id: string; user_id: string; value?: number | null }[] = []
  let departments: { id: string; name: string }[] = []

  try {
    const [ideasRes, votesRes, deptsRes] = await Promise.all([
      supabase
        .from('ideas')
        .select('*, profiles:created_by(id, full_name, email, avatar_url), departments(id, name)')
        .order('created_at', { ascending: false }),
      supabase.from('idea_votes').select('idea_id, user_id, value'),
      supabase.from('departments').select('id, name').order('name'),
    ])
    ideas = (ideasRes.data || []) as unknown as typeof ideas
    voteRows = (votesRes.data || []) as typeof voteRows
    departments = (deptsRes.data || []) as typeof departments
  } catch { /* tables may not exist yet */ }

  const likeCounts: Record<string, number> = {}
  const dislikeCounts: Record<string, number> = {}
  const myLikeIds: string[] = []
  const myDislikeIds: string[] = []
  for (const v of voteRows) {
    const val = (v.value ?? 1) // legacy rows default to like
    if (val === 1) {
      likeCounts[v.idea_id] = (likeCounts[v.idea_id] || 0) + 1
      if (v.user_id === user.id) myLikeIds.push(v.idea_id)
    } else if (val === -1) {
      dislikeCounts[v.idea_id] = (dislikeCounts[v.idea_id] || 0) + 1
      if (v.user_id === user.id) myDislikeIds.push(v.idea_id)
    }
  }

  return (
    <IdeaMarketClient
      profile={profile}
      initIdeas={ideas}
      likeCounts={likeCounts}
      dislikeCounts={dislikeCounts}
      myLikeIds={myLikeIds}
      myDislikeIds={myDislikeIds}
      departments={departments}
    />
  )
}
