import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { tplTaskAssigned } from '@/lib/email/templates'

// POST /api/email/task-assigned
// Body: { source: 'project'|'goal'|'department', taskId: string, assigneeId: string }
// Fired by the UI after assigning/creating a task with an assignee. The
// caller passes the source so we know which table to read for context.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { source, taskId, assigneeId } = await request.json().catch(() => ({}))
  if (!source || !taskId || !assigneeId) {
    return NextResponse.json({ error: 'source, taskId, assigneeId required' }, { status: 400 })
  }
  if (assigneeId === user.id) {
    // Assigning to yourself — no need to email.
    return NextResponse.json({ ok: true, skipped: 'self' })
  }

  const admin = createAdminClient()

  let title = ''
  let containerName: string | null = null
  let href: string | null = null

  if (source === 'project') {
    const { data } = await admin
      .from('tasks')
      .select('title, project_id, projects(name)')
      .eq('id', taskId)
      .single() as { data: { title: string; project_id: string; projects: { name: string } | null } | null }
    if (!data) return NextResponse.json({ error: 'task not found' }, { status: 404 })
    title = data.title
    containerName = data.projects?.name ?? null
    href = `/project-board/${data.project_id}`
  } else if (source === 'goal') {
    const { data } = await admin
      .from('goal_step_tasks')
      .select('title, step_id, goal_steps(goal_id, goals(title))')
      .eq('id', taskId)
      .single() as { data: { title: string; step_id: string; goal_steps: { goal_id: string; goals: { title: string } | null } | null } | null }
    if (!data) return NextResponse.json({ error: 'task not found' }, { status: 404 })
    title = data.title
    containerName = data.goal_steps?.goals?.title ?? null
    href = data.goal_steps?.goal_id ? `/goals/${data.goal_steps.goal_id}` : null
  } else if (source === 'department') {
    const { data } = await admin
      .from('department_recurring_tasks')
      .select('name, department_id, departments(name)')
      .eq('id', taskId)
      .single() as { data: { name: string; department_id: string; departments: { name: string } | null } | null }
    if (!data) return NextResponse.json({ error: 'task not found' }, { status: 404 })
    title = data.name
    containerName = data.departments?.name ?? null
    href = `/departments/${data.department_id}`
  } else {
    return NextResponse.json({ error: 'invalid source' }, { status: 400 })
  }

  const { data: assignee } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', assigneeId)
    .single()
  if (!assignee?.email) return NextResponse.json({ error: 'assignee email missing' }, { status: 404 })

  const tpl = tplTaskAssigned({
    recipientName: assignee.full_name ?? undefined,
    taskTitle: title,
    source: source as 'project' | 'goal' | 'department',
    containerName,
    href,
  })
  const ok = await sendEmail({ to: assignee.email, subject: tpl.subject, html: tpl.html })
  return NextResponse.json({ ok })
}
