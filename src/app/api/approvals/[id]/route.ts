import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = verifyOrigin(req)
  if (csrfError) return csrfError

  // Authorization: this endpoint mutates anyone's points balance, so we
  // gate it on super-admin. Previously the route had no auth check at all,
  // meaning any unauthenticated client could approve/reject pending points.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { action } = await req.json() // 'approve' | 'reject'
  const { id } = await params

  if (!['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Fetch the pending_points row
  const { data: pending, error: fetchErr } = await adminClient
    .from('pending_points')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (fetchErr || !pending) {
    return NextResponse.json({ error: 'Not found or already reviewed' }, { status: 404 })
  }

  if (action === 'approve') {
    // Update total_points
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('total_points')
      .eq('id', pending.user_id)
      .single()

    const newPoints = (targetProfile?.total_points ?? 0) + pending.points

    await adminClient
      .from('profiles')
      .update({ total_points: newPoints, updated_at: new Date().toISOString() })
      .eq('id', pending.user_id)

    // Mark task as points_awarded
    if (pending.object_type === 'task' && pending.object_id) {
      await adminClient
        .from('tasks')
        .update({ points_awarded: true })
        .eq('id', pending.object_id)
    }

    // Mark pending row as approved
    await adminClient
      .from('pending_points')
      .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', id)

    return NextResponse.json({ ok: true })
  }

  // Reject
  await adminClient
    .from('pending_points')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
