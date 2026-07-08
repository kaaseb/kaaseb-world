import { createClient } from '@/lib/supabase/server'
import { DailyTasksClient } from '@/components/daily-tasks/DailyTasksClient'

export type MyTaskRow = {
  source: 'project' | 'department' | 'goal'
  id: string
  title: string
  description: string | null
  done: boolean
  points: number
  // Container metadata (project / department / goal)
  containerHref: string | null
  containerName: string | null
}

export default async function DailyTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single()

  const now = new Date().toISOString()

  // Reset expired recurring tasks (set completed=false, extend expires_at by 24h) — own tasks only
  const { data: expiredRecurring } = await supabase
    .from('daily_tasks')
    .select('id')
    .eq('task_type', 'recurring')
    .eq('created_by', user!.id)
    .lte('expires_at', now)

  if (expiredRecurring && expiredRecurring.length > 0) {
    const ids = expiredRecurring.map(t => t.id)
    const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await supabase
      .from('daily_tasks')
      .update({ completed: false, expires_at: newExpiry })
      .in('id', ids)
  }

  // Delete expired one-time tasks — own tasks only
  await supabase
    .from('daily_tasks')
    .delete()
    .eq('task_type', 'one_time')
    .eq('created_by', user!.id)
    .lte('expires_at', now)

  // Fetch own daily tasks
  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select(`*, profiles!assigned_user_id(full_name, avatar_url)`)
    .eq('created_by', user!.id)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name')

  // -------- "My Tasks" tab: pull from all sources where I am the assignee --------
  // Department recurring tasks have a separate completions table that records
  // (task_id, user_id, date). We hydrate the `done` flag for today's date.
  const today = new Date().toISOString().slice(0, 10)
  const [projectTasksRes, deptTasksRes, goalTasksRes, deptCompletionsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, description, status, points, project_id, projects(id, name)')
      .eq('assigned_user_id', user!.id),
    supabase
      .from('department_recurring_tasks')
      .select('id, name, description, points, department_id, departments(id, name)')
      .eq('assigned_user_id', user!.id),
    supabase
      .from('goal_step_tasks')
      .select('id, title, completed, assigned_user_id, assigned_to_everyone, step_id, goal_steps(id, goal_id, goals(id, title))')
      .or(`assigned_user_id.eq.${user!.id},assigned_to_everyone.eq.true`),
    supabase
      .from('department_recurring_completions')
      .select('task_id')
      .eq('user_id', user!.id)
      .eq('completed_date', today),
  ])
  const completedDeptTaskIds = new Set((deptCompletionsRes.data || []).map(r => r.task_id))

  const myTasks: MyTaskRow[] = []

  for (const t of ((projectTasksRes.data || []) as unknown as ProjectTaskRow[])) {
    myTasks.push({
      source: 'project',
      id: t.id,
      title: t.title,
      description: t.description,
      done: t.status === 'done' || t.status === 'completed',
      points: t.points || 0,
      containerHref: t.project_id ? `/project-board/${t.project_id}` : null,
      containerName: t.projects?.name || null,
    })
  }
  for (const t of ((deptTasksRes.data || []) as unknown as DeptTaskRow[])) {
    myTasks.push({
      source: 'department',
      id: t.id,
      title: t.name,
      description: t.description,
      done: completedDeptTaskIds.has(t.id),
      points: t.points || 0,
      containerHref: t.department_id ? `/departments/${t.department_id}` : null,
      containerName: t.departments?.name || null,
    })
  }
  for (const t of ((goalTasksRes.data || []) as unknown as GoalTaskRow[])) {
    const goal = t.goal_steps?.goals
    myTasks.push({
      source: 'goal',
      id: t.id,
      title: t.title,
      description: null,
      done: !!t.completed,
      points: 0,
      containerHref: goal?.id ? `/goals/${goal.id}` : null,
      containerName: goal?.title || null,
    })
  }

  return (
    <DailyTasksClient
      tasks={tasks || []}
      profile={profile}
      departments={departments || []}
      myTasks={myTasks}
    />
  )
}

type ProjectTaskRow = {
  id: string
  title: string
  description: string | null
  status: string
  points: number
  project_id: string
  projects: { id: string; name: string } | null
}

type DeptTaskRow = {
  id: string
  name: string
  description: string | null
  points: number
  department_id: string
  departments: { id: string; name: string } | null
}

type GoalTaskRow = {
  id: string
  title: string
  completed: boolean
  step_id: string
  goal_steps: { id: string; goal_id: string; goals: { id: string; title: string } | null } | null
}
