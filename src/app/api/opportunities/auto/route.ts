// GET  /api/opportunities/auto — is the daily auto-scan on?
// POST /api/opportunities/auto { on: boolean } — turn it on/off from the page.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getAutoScan, setAutoScan } from '@/lib/scout/auto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { error: null }
}

export async function GET() {
  const { error } = await guard()
  if (error) return error
  return NextResponse.json({ on: await getAutoScan('opportunities') })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { error } = await guard()
  if (error) return error

  let body: { on?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on (boolean) required' }, { status: 400 })

  await setAutoScan('opportunities', body.on)
  return NextResponse.json({ on: body.on })
}
