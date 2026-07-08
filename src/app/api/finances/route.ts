import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'

// Verify the caller is super_admin
async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') return null
  return user.id
}

// POST /api/finances  { table, action, payload, id }
export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const userId = await assertSuperAdmin()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { table, action, payload, id } = await request.json()

  const validTables = ['finance_dues', 'finance_income', 'finance_goals', 'finance_goal_steps', 'finance_opportunities']
  if (!validTables.includes(table)) {
    return NextResponse.json({ error: 'Invalid table' }, { status: 400 })
  }

  const admin = createAdminClient()

  try {
    if (action === 'insert') {
      const { data, error } = await admin
        .from(table)
        .insert({ ...payload, created_by: userId })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ data })
    }

    if (action === 'update') {
      const { data, error } = await admin
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ data })
    }

    if (action === 'delete') {
      const { error } = await admin.from(table).delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'delete_where') {
      // e.g. delete all steps for a goal: { field: 'goal_id', value: goalId }
      const { field, value } = payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from(table) as any).delete().eq(field as string, value)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'insert_many') {
      // payload is an array, each item gets created_by only if the table needs it
      const items = Array.isArray(payload) ? payload : []
      const { data, error } = await admin.from(table).insert(items).select()
      if (error) throw error
      return NextResponse.json({ data })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Database error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
