// Tool definitions + executors for Ghassl AI. All tools are READ-ONLY.
// Each tool gets a Supabase client (server, scoped to the calling user via RLS).

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ToolDeclaration {
  name: string
  description: string
  parametersJsonSchema: Record<string, unknown>
}

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'list_employees',
    description: 'List employees / team members. Use this whenever the user asks about people, top performers, points, or roles. Default returns up to 20 sorted by total_points desc.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        orderBy: { type: 'string', enum: ['points', 'name', 'created_at'], description: 'Sort key. Default "points".' },
        direction: { type: 'string', enum: ['asc', 'desc'], description: 'Default "desc".' },
        limit: { type: 'integer', description: 'Max rows to return (1-50). Default 20.' },
        role: { type: 'string', enum: ['super_admin', 'project_manager', 'employee'], description: 'Optional role filter.' },
        search: { type: 'string', description: 'Optional substring match against full_name, email, or title.' },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks across project tasks (table "tasks") AND daily tasks (table "daily_tasks"). Use this when the user asks about overdue, in-progress, completed, or any task-related question.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['project', 'daily', 'both'], description: 'Which task source. Default "both".' },
        status: { type: 'string', description: 'Project task status filter (e.g. "backlog", "in_progress", "done").' },
        completed: { type: 'boolean', description: 'For daily tasks: true returns completed only, false returns pending only.' },
        overdueOnly: { type: 'boolean', description: 'Return only overdue items (expires_at < now for daily; no due field for project so this is ignored there).' },
        assigneeId: { type: 'string', description: 'Filter by assigned user id.' },
        limit: { type: 'integer', description: 'Default 30, max 100.' },
      },
    },
  },
  {
    name: 'list_projects',
    description: 'List projects with status, department, and task counts. Use for project status questions.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'completed', 'archived'], description: 'Optional status filter.' },
        limit: { type: 'integer', description: 'Default 20, max 50.' },
      },
    },
  },
  {
    name: 'list_goals',
    description: 'List goals with completion status. Use for goal-related questions.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'true = only completed, false = only active. Omit for both.' },
        limit: { type: 'integer', description: 'Default 20, max 50.' },
      },
    },
  },
  {
    name: 'list_departments',
    description: 'List all departments with their member counts. Use when asked about departments or team structure.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'team_stats',
    description: 'Get top-level counts: total employees, total projects (active/completed), total tasks (overdue/pending/done), total goals (active/done). Use for "overview" or "stats" questions.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'employees_without_active_tasks',
    description: 'List employees who have NO active (uncompleted) tasks assigned to them, across both project and daily tasks.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Default 20, max 50.' },
      },
    },
  },
]

// Map of name -> executor. Each receives the args + the supabase client and returns plain JSON.
export const TOOL_EXECUTORS: Record<
  string,
  (args: Record<string, unknown>, supabase: SupabaseClient) => Promise<unknown>
> = {
  async list_employees(args, supabase) {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
    const orderBy = (args.orderBy as string) || 'points'
    const direction = (args.direction as string) || 'desc'
    const role = args.role as string | undefined
    const search = args.search as string | undefined

    const sortCol = orderBy === 'points' ? 'total_points' : orderBy === 'name' ? 'full_name' : 'created_at'

    let q = supabase.from('profiles').select('id, full_name, email, role, title, total_points, created_at')
    if (role) q = q.eq('role', role)
    if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,title.ilike.%${search}%`)
    q = q.order(sortCol, { ascending: direction === 'asc' }).limit(limit)

    const { data, error } = await q
    if (error) return { error: error.message }
    return { count: data?.length || 0, employees: data || [] }
  },

  async list_tasks(args, supabase) {
    const source = (args.source as string) || 'both'
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 30))
    const result: Record<string, unknown> = {}

    if (source === 'project' || source === 'both') {
      let q = supabase
        .from('tasks')
        .select('id, title, status, points, project_id, assigned_user_id, created_at, projects(name), profiles:assigned_user_id(full_name, email)')
      if (args.status) q = q.eq('status', args.status as string)
      if (args.assigneeId) q = q.eq('assigned_user_id', args.assigneeId as string)
      q = q.order('created_at', { ascending: false }).limit(limit)
      const { data, error } = await q
      result.project_tasks = error ? { error: error.message } : data
    }

    if (source === 'daily' || source === 'both') {
      let q = supabase
        .from('daily_tasks')
        .select('id, title, completed, task_type, expires_at, points, assigned_user_id, department_id, profiles:assigned_user_id(full_name, email), departments(name)')
      if (typeof args.completed === 'boolean') q = q.eq('completed', args.completed)
      if (args.assigneeId) q = q.eq('assigned_user_id', args.assigneeId as string)
      if (args.overdueOnly) q = q.lt('expires_at', new Date().toISOString())
      q = q.order('expires_at', { ascending: true }).limit(limit)
      const { data, error } = await q
      result.daily_tasks = error ? { error: error.message } : data
    }

    return result
  },

  async list_projects(args, supabase) {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
    let q = supabase
      .from('projects')
      .select('id, name, status, department_id, created_at, departments(name)')
    if (args.status) q = q.eq('status', args.status as string)
    q = q.order('created_at', { ascending: false }).limit(limit)
    const { data: projects, error } = await q
    if (error) return { error: error.message }

    // Task counts per project
    const ids = (projects || []).map(p => p.id)
    const tasksByProject: Record<string, { total: number; done: number }> = {}
    if (ids.length > 0) {
      const { data: ts } = await supabase
        .from('tasks').select('project_id, status').in('project_id', ids)
      for (const t of ts || []) {
        const key = t.project_id as string
        if (!tasksByProject[key]) tasksByProject[key] = { total: 0, done: 0 }
        tasksByProject[key].total += 1
        if (t.status === 'done' || t.status === 'completed') tasksByProject[key].done += 1
      }
    }

    return {
      count: projects?.length || 0,
      projects: (projects || []).map(p => ({
        ...p,
        task_total: tasksByProject[p.id]?.total || 0,
        task_done: tasksByProject[p.id]?.done || 0,
      })),
    }
  },

  async list_goals(args, supabase) {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
    let q = supabase
      .from('goals')
      .select('id, title, description, completed, is_global, department_id, created_at, departments(name)')
    if (typeof args.completed === 'boolean') q = q.eq('completed', args.completed)
    q = q.order('created_at', { ascending: false }).limit(limit)
    const { data, error } = await q
    if (error) return { error: error.message }
    return { count: data?.length || 0, goals: data || [] }
  },

  async list_departments(_args, supabase) {
    const { data: depts, error } = await supabase
      .from('departments').select('id, name').order('name')
    if (error) return { error: error.message }
    return { count: depts?.length || 0, departments: depts || [] }
  },

  async team_stats(_args, supabase) {
    const now = new Date().toISOString()
    const [
      employees,
      projectsActive, projectsCompleted,
      tasksDone, tasksOpen,
      dailyOpen, dailyOverdue,
      goalsActive, goalsDone,
      departments,
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).in('status', ['done', 'completed']),
      supabase.from('tasks').select('*', { count: 'exact', head: true }).not('status', 'in', '("done","completed")'),
      supabase.from('daily_tasks').select('*', { count: 'exact', head: true }).eq('completed', false),
      supabase.from('daily_tasks').select('*', { count: 'exact', head: true }).eq('completed', false).lt('expires_at', now),
      supabase.from('goals').select('*', { count: 'exact', head: true }).eq('completed', false),
      supabase.from('goals').select('*', { count: 'exact', head: true }).eq('completed', true),
      supabase.from('departments').select('*', { count: 'exact', head: true }),
    ])

    return {
      employees: employees.count || 0,
      departments: departments.count || 0,
      projects: { active: projectsActive.count || 0, completed: projectsCompleted.count || 0 },
      project_tasks: { done: tasksDone.count || 0, open: tasksOpen.count || 0 },
      daily_tasks: { open: dailyOpen.count || 0, overdue: dailyOverdue.count || 0 },
      goals: { active: goalsActive.count || 0, completed: goalsDone.count || 0 },
    }
  },

  async employees_without_active_tasks(args, supabase) {
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
    const { data: employees } = await supabase
      .from('profiles').select('id, full_name, email, role, title, total_points')

    const [{ data: openProjectTasks }, { data: openDaily }] = await Promise.all([
      supabase.from('tasks').select('assigned_user_id').not('status', 'in', '("done","completed")'),
      supabase.from('daily_tasks').select('assigned_user_id').eq('completed', false),
    ])

    const busy = new Set<string>()
    for (const t of openProjectTasks || []) if (t.assigned_user_id) busy.add(t.assigned_user_id as string)
    for (const t of openDaily || []) if (t.assigned_user_id) busy.add(t.assigned_user_id as string)

    const free = (employees || []).filter(e => !busy.has(e.id)).slice(0, limit)
    return { count: free.length, employees: free }
  },
}
