import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { BADGES, type BadgeStats } from '@/lib/badges'

// GET: compute the caller's stats + earned/missing badges, and insert any
// newly-earned rows. Returns the current earned list and upcoming progress.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()

    const { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).single()
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Gather stats in parallel. Each query is best-effort — missing tables
    // (e.g. when migrations haven't run) degrade to 0 silently.
    type Thenable = PromiseLike<{ count: number | null }>
    const safeCount = async (q: Thenable) => {
      try { return (await q).count || 0 } catch { return 0 }
    }
    const safeBool = async (q: Thenable) => (await safeCount(q)) > 0

    const [
      tasksCompleted,
      dailyTasksCompleted,
      ideasCount,
      ideasImplemented,
      votesCount,
      storiesCount,
      isDepartmentMember,
      completedGoals,
      existingBadges,
    ] = await Promise.all([
      safeCount(admin.from('tasks').select('*', { count: 'exact', head: true })
        .eq('assigned_user_id', user.id).eq('status', 'done')),
      safeCount(admin.from('daily_tasks').select('*', { count: 'exact', head: true })
        .eq('created_by', user.id).eq('completed', true)),
      safeCount(admin.from('ideas').select('*', { count: 'exact', head: true }).eq('created_by', user.id)),
      safeCount(admin.from('ideas').select('*', { count: 'exact', head: true })
        .eq('created_by', user.id).eq('status', 'implemented')),
      safeCount(admin.from('idea_votes').select('*', { count: 'exact', head: true }).eq('user_id', user.id)),
      safeCount(admin.from('stories').select('*', { count: 'exact', head: true }).eq('user_id', user.id)),
      safeBool(admin.from('department_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id)),
      safeCount(admin.from('goals').select('*', { count: 'exact', head: true })
        .eq('created_by', user.id).eq('completed', true)),
      admin.from('user_badges').select('badge_key').eq('user_id', user.id),
    ])

    const stats: BadgeStats = {
      tasksCompleted,
      dailyTasksCompleted,
      totalPoints: profile.total_points ?? 0,
      ideasCount,
      ideasImplemented,
      votesCount,
      storiesCount,
      isDepartmentMember,
      hasCompletedGoal: completedGoals > 0,
      createdAt: profile.created_at,
    }

    const alreadyEarned = new Set(((existingBadges.data as { badge_key: string }[] | null) ?? []).map(r => r.badge_key))

    const toInsert: { user_id: string; badge_key: string }[] = []
    const progressMap: Record<string, number> = {}
    for (const b of BADGES) {
      const p = b.progress(stats)
      progressMap[b.key] = p
      if (p >= 1 && !alreadyEarned.has(b.key)) {
        toInsert.push({ user_id: user.id, badge_key: b.key })
      }
    }

    if (toInsert.length > 0) {
      await admin.from('user_badges').upsert(toInsert, { onConflict: 'user_id,badge_key' })
    }

    const earned = new Set(alreadyEarned)
    for (const row of toInsert) earned.add(row.badge_key)

    return NextResponse.json({
      stats,
      earned: Array.from(earned),
      newlyEarned: toInsert.map(r => r.badge_key),
      progress: progressMap,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
