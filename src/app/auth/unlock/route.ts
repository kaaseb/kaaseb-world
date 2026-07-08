import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnlockToken } from '@/lib/unlock-token'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${origin}/login?error=invalid_token`)
  }

  const verified = verifyUnlockToken(token)
  if (!verified) {
    return NextResponse.redirect(`${origin}/login?error=invalid_token`)
  }

  // Use the admin client so the disable proceeds even if the user has no active
  // session in this browser (the whole point of the reset flow). The token's
  // HMAC signature is what proves the request is authorized — RLS would reject
  // an unauthenticated update, which is why this path needs the service role.
  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ lock_enabled: false, lock_password_hash: null })
    .eq('id', verified.userId)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=unlock_failed`)
  }

  return NextResponse.redirect(`${origin}/?unlock=success`)
}
