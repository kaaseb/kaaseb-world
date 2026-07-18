// POST /api/inbox/pin — change the inbox secret. SUPER ADMIN ONLY.
//
// Role-gated, not PIN-gated: the super admin can always reset the secret (even if
// they forgot the current one), which is the recovery path. Changing it also
// re-issues this caller's unlock cookie so they aren't locked out by their own
// change, and invalidates every OTHER device (their cookie no longer matches).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { setPin, INBOX_COOKIE, INBOX_COOKIE_MAXAGE } from '@/lib/inbox/lock'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'هذا الإجراء للسوبر أدمن فقط.' }, { status: 403 })
  }

  let body: { newPin?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const newPin = typeof body.newPin === 'string' ? body.newPin : ''

  const result = await setPin(newPin)
  if (!result.ok) return NextResponse.json({ error: result.error || 'رقم غير صالح' }, { status: 400 })

  const res = NextResponse.json({ ok: true })
  if (result.unlockToken) {
    res.cookies.set(INBOX_COOKIE, result.unlockToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: INBOX_COOKIE_MAXAGE,
    })
  }
  return res
}
