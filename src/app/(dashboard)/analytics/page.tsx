import { createClient } from '@/lib/supabase/server'
import { AnalyticsClient } from '@/components/analytics/AnalyticsClient'

export default async function AnalyticsPage() {
  const supabase = await createClient()

  const [r1, r2, r3, r4, r5] = await Promise.all([
    supabase.from('departments').select('*', { count: 'exact', head: true }),
    supabase.from('projects').select('*', { count: 'exact', head: true }),
    supabase.from('tasks').select('*', { count: 'exact', head: true }),
    supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'done'),
    supabase.from('profiles').select('full_name, total_points, avatar_url').order('total_points', { ascending: false }).limit(10),
  ])

  return (
    <AnalyticsClient
      totalDepts={r1.count || 0}
      totalProjects={r2.count || 0}
      totalTasks={r3.count || 0}
      doneTasks={r4.count || 0}
      topUsers={r5.data || []}
    />
  )
}
