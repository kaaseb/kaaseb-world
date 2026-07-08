import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CalendarClient } from '@/components/calendar/CalendarClient'
import { getProfileOrFallback } from '@/lib/profile'

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  // Load reference data in parallel. Events are fetched without a date
  // filter so client-side month navigation is instant — for a small/medium
  // team this is far cheaper than a network round-trip per month change.
  const [eventsRes, deptsRes, goalsRes, projectsRes, usersRes] = await Promise.all([
    supabase
      .from('events')
      .select(`
        *,
        creator:created_by(id, full_name, email, avatar_url),
        event_departments(department_id),
        event_goals(goal_id),
        event_projects(project_id),
        event_attendees(user_id, status, awarded_points, marked_by, marked_at)
      `)
      .order('event_date', { ascending: true }),
    supabase.from('departments').select('id, name').order('name'),
    supabase.from('goals').select('id, title, department_id').order('created_at', { ascending: false }),
    supabase.from('projects').select('id, name, department_id').order('name'),
    supabase.from('profiles').select('id, full_name, email, avatar_url, role').order('full_name'),
  ])

  return (
    <CalendarClient
      profile={profile}
      events={eventsRes.data ?? []}
      departments={deptsRes.data ?? []}
      goals={goalsRes.data ?? []}
      projects={projectsRes.data ?? []}
      users={usersRes.data ?? []}
    />
  )
}
