// GET /api/opportunities — the scouted list + the last scan's status.
// Read-only, so no CSRF check (same as /api/visualize/jobs).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getState } from '@/lib/opportunities/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { items, lastRun } = await getState()
  return NextResponse.json({ items, lastRun })
}
