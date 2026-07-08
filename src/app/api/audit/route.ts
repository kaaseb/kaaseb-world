import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

const ALLOWED_ACTIONS = new Set(['create', 'edit', 'delete', 'view', 'login', 'logout'])

export async function POST(req: NextRequest) {
  const csrfError = verifyOrigin(req)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Validate action_type so callers can't sprinkle arbitrary strings into the
  // audit log. Reject unknown values rather than silently coercing.
  if (typeof body.action_type !== 'string' || !ALLOWED_ACTIONS.has(body.action_type)) {
    return NextResponse.json({ error: 'Invalid action_type' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Look up the canonical profile rather than trusting client-supplied
  // user_name / user_email — those were spoofable for misleading entries.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  const { error } = await admin.from('audit_logs').insert({
    user_id: user.id,
    user_name: profile?.full_name ?? null,
    user_email: profile?.email ?? user.email ?? null,
    action_type: body.action_type,
    object_type: typeof body.object_type === 'string' ? body.object_type.slice(0, 64) : null,
    object_name: typeof body.object_name === 'string' ? body.object_name.slice(0, 256) : null,
    object_id: typeof body.object_id === 'string' ? body.object_id : null,
  })

  if (error) {
    console.error('[audit insert error]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
