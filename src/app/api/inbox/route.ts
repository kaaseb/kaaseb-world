// GET /api/inbox — pulled emails + last-pull status.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getInboxState } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { items, lastRun } = await getInboxState()
  return NextResponse.json({ items, lastRun })
}
