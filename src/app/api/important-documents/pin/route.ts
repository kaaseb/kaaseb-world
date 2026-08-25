// POST /api/important-documents/pin — set / change / clear the docs secret.
// SUPER ADMIN ONLY.
//
// Body: { newPin } to set or change the PIN; { clear: true } to disable the gate.
// Role-gated (not PIN-gated) so the super admin is the recovery path even if they
// forgot the current PIN. Setting also re-issues this caller's unlock cookie so
// they aren't locked out by their own change, and invalidates every OTHER device.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { setDocsPin, clearDocsPin, DOCS_COOKIE, DOCS_COOKIE_MAXAGE } from '@/lib/docs/lock'

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

  let body: { newPin?: unknown; clear?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (body.clear === true) {
    await clearDocsPin()
    const res = NextResponse.json({ ok: true, cleared: true })
    // Drop this device's cookie too (the token no longer matches anyway).
    res.cookies.set(DOCS_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  }

  const newPin = typeof body.newPin === 'string' ? body.newPin : ''
  const result = await setDocsPin(newPin)
  if (!result.ok) return NextResponse.json({ error: result.error || 'رقم غير صالح' }, { status: 400 })

  const res = NextResponse.json({ ok: true })
  if (result.unlockToken) {
    res.cookies.set(DOCS_COOKIE, result.unlockToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: DOCS_COOKIE_MAXAGE,
    })
  }
  return res
}
