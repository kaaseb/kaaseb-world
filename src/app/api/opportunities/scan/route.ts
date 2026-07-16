// POST /api/opportunities/scan — the "تحديث الآن" button.
//
// Fire-and-forget like the visualize renders: a web search takes a minute or
// two, so we start it and return 202 immediately. The page polls
// GET /api/opportunities and watches `lastRun.status` to know when it lands.
//
// This endpoint costs money, so it is gated on the page permission (not just a
// session) and refuses to stack scans.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getState } from '@/lib/opportunities/store'
import { runScan } from '@/lib/opportunities/search'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Cheap pre-check for a friendly message. beginRun() inside runScan is the
  // real guard against two scans racing.
  const { lastRun } = await getState()
  if (lastRun?.status === 'running') {
    return NextResponse.json({ error: 'البحث شغّال حالياً — انتظر لين يخلص.' }, { status: 409 })
  }

  const by = profile.full_name || profile.email || null
  void runScan({ trigger: 'manual', by }).catch(() => {
    /* runScan records its own failure in lastRun; nothing to do here */
  })

  return NextResponse.json({ started: true }, { status: 202 })
}
