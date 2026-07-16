// GET /api/companies — the target account list + the last scan's status.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getCompaniesState } from '@/lib/companies/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.companies')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { items, lastRun } = await getCompaniesState()
  return NextResponse.json({ items, lastRun })
}
