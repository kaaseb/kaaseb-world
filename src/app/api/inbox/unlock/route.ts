// POST /api/inbox/unlock — exchange the shared PIN for an unlock cookie.
//
// Requires page.inbox (so only users who could reach the page can even try) plus
// the secret PIN on top. On success we set an httpOnly cookie whose value is
// derived from the current PIN hash, so a PIN change invalidates it everywhere.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { verifyPin, currentUnlockToken, INBOX_COOKIE, INBOX_COOKIE_MAXAGE } from '@/lib/inbox/lock'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { pin?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const pin = typeof body.pin === 'string' ? body.pin : ''

  if (!(await verifyPin(pin))) {
    return NextResponse.json({ error: 'رقم سري خاطئ' }, { status: 401 })
  }

  const token = await currentUnlockToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(INBOX_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: INBOX_COOKIE_MAXAGE,
  })
  return res
}
