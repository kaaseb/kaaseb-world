import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

// Generates a cryptographically random 16-char password (URL-safe alphabet,
// no ambiguous characters) so each invited user gets a unique credential.
function generateInvitePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let pw = ''
  for (let i = 0; i < 16; i++) pw += alphabet[bytes[i] % alphabet.length]
  return pw
}

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { email, role, fullName, title, offDays, customRoleId, isDepartmentManager, scope } = await request.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const password = generateInvitePassword()

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: role || 'employee',
        full_name: fullName || '',
      },
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    if (data.user?.id) {
      // Always set must_change_password so the invitee is forced to pick their
      // own password on first login — the server-issued one is throw-away.
      const patch: Record<string, unknown> = { must_change_password: true }
      if (Array.isArray(offDays) && offDays.length > 0) patch.off_days = offDays
      if (customRoleId) patch.custom_role_id = customRoleId
      if (typeof isDepartmentManager === 'boolean') patch.is_department_manager = isDepartmentManager
      if (typeof scope === 'string' && scope.length > 0) patch.scope = scope
      if (typeof title === 'string' && title.trim()) patch.title = title.trim()
      await admin.from('profiles').update(patch).eq('id', data.user.id)
    }

    // Return the password to the admin ONCE so they can hand it to the user.
    // It is never persisted in plaintext anywhere.
    return NextResponse.json({ success: true, userId: data.user?.id, password })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
