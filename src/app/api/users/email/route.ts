// PATCH /api/users/email — change a user's auth email + sync the profile row.
//
// Why a dedicated route: changing the auth email is a sensitive operation
// (it changes how the user logs in and where password-reset mails go), so we
// keep it off the role/off-days dialog's main save handler and require the
// admin to deliberately click "Change email".
//
// Auth: super_admin only.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'
import { NextResponse } from 'next/server'

// Loose RFC-5321-ish check — Supabase will reject anything genuinely invalid
// at the auth layer; this just catches obvious typos before the round-trip.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function PATCH(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: { userId?: string; email?: string }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
    }

    const userId = (body.userId || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (!email || !looksLikeEmail(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    // Skip the round-trip entirely if the email already matches — keeps the
    // audit log clean and avoids a no-op email_change confirmation on the
    // auth side.
    const { data: current } = await admin
      .from('profiles').select('email, full_name').eq('id', userId).maybeSingle()
    if (current?.email && current.email.toLowerCase() === email) {
      return NextResponse.json({ success: true, email, unchanged: true })
    }

    // `email_confirm: true` flips the new address straight to verified so
    // the user can log in with it on the next attempt — no confirmation
    // email round-trip required, which is what the team wants since an
    // admin is the one driving the change.
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    })
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })

    // Keep the profiles table in sync. The profiles row is what the UI reads
    // for display — if we only update auth.users the list would still show
    // the old address until the next session refresh.
    const { error: profileErr } = await admin
      .from('profiles').update({ email }).eq('id', userId)
    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

    await serverAudit({
      user, supabase, action: 'edit', objectType: 'user_email',
      objectName: current?.full_name || email, objectId: userId,
    })

    return NextResponse.json({ success: true, email })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
