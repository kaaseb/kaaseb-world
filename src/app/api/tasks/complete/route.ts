import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { taskId, newStatus } = await request.json()
    if (!taskId || !newStatus) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const admin = createAdminClient()

    // Fetch current task state + title
    const { data: task, error: fetchError } = await admin
      .from('tasks')
      .select('id, title, status, points, points_awarded, assigned_user_id')
      .eq('id', taskId)
      .single()

    if (fetchError || !task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Authorization: only the task assignee, a project_manager, or a super_admin
    // may change status. Otherwise an employee could mark anyone else's tasks
    // done and pump up their pending-points queue.
    const { data: actorRoleProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const actorRole = actorRoleProfile?.role
    const isPrivileged = actorRole === 'super_admin' || actorRole === 'project_manager'
    if (!isPrivileged && task.assigned_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch actor profile for audit log
    const { data: actorProfile } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', user.id)
      .single()

    // Update task status
    const { error: updateError } = await admin
      .from('tasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', taskId)

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    // Audit log: record task status change
    const { error: auditErr } = await admin.from('audit_logs').insert({
      user_id: user.id,
      user_name: actorProfile?.full_name ?? null,
      user_email: actorProfile?.email ?? user.email ?? null,
      action_type: 'edit',
      object_type: 'task',
      object_name: task.title,
      object_id: taskId,
    })
    if (auditErr) console.error('[audit_logs insert error]', auditErr.message)

    let pendingInserted = false

    // Task moved TO done — insert into pending_points for approval
    if (
      newStatus === 'done' &&
      task.status !== 'done' &&
      task.assigned_user_id &&
      task.points > 0 &&
      !task.points_awarded
    ) {
      const { data: assigneeProfile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', task.assigned_user_id)
        .single()

      const { error: pendingErr } = await admin.from('pending_points').insert({
        user_id: task.assigned_user_id,
        user_name: assigneeProfile?.full_name ?? null,
        user_email: assigneeProfile?.email ?? null,
        object_type: 'task',
        object_name: task.title,
        object_id: taskId,
        points: task.points,
      })

      if (pendingErr) {
        console.error('[pending_points insert error]', pendingErr.message)
        return NextResponse.json({ error: `pending_points: ${pendingErr.message}` }, { status: 500 })
      }

      pendingInserted = true

      // Notify all super_admins about pending approval
      const { data: superAdmins } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'super_admin')

      if (superAdmins && superAdmins.length > 0) {
        await admin.from('notifications').insert(
          superAdmins.map((sa: { id: string }) => ({
            sender_id: user.id,
            recipient_id: sa.id,
            is_broadcast: false,
            title: 'طلب موافقة على نقاط',
            message: `${assigneeProfile?.full_name ?? 'مستخدم'} أنهى مهمة "${task.title}" وينتظر موافقتك على ${task.points} نقطة.`,
          }))
        )
      }
    }

    // Task moved AWAY from done — remove pending row (if not yet approved) or deduct if approved
    if (
      task.status === 'done' &&
      newStatus !== 'done' &&
      task.assigned_user_id
    ) {
      // Delete any still-pending row for this task
      await admin
        .from('pending_points')
        .delete()
        .eq('object_id', taskId)
        .eq('user_id', task.assigned_user_id)
        .eq('status', 'pending')

      // If points were already approved, deduct them
      if (task.points_awarded) {
        const { data: profile } = await admin
          .from('profiles')
          .select('total_points')
          .eq('id', task.assigned_user_id)
          .single()

        if (profile) {
          await admin
            .from('profiles')
            .update({ total_points: Math.max(0, (profile.total_points ?? 0) - task.points) })
            .eq('id', task.assigned_user_id)
        }

        await admin.from('tasks').update({ points_awarded: false }).eq('id', taskId)
      }
    }

    return NextResponse.json({ success: true, pointsAwarded: false, pendingApproval: pendingInserted })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
