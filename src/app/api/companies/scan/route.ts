// POST /api/companies/scan — the "تحديث الآن" button on شركات مستهدفة.
// Fire-and-forget + poll, exactly like /api/opportunities/scan.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getCompaniesState } from '@/lib/companies/store'
import { runCompanyScan } from '@/lib/companies/search'

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
  if (!hasPermission(profile, permissions, 'page.companies')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { lastRun } = await getCompaniesState()
  if (lastRun?.status === 'running') {
    return NextResponse.json({ error: 'البحث شغّال حالياً — انتظر لين يخلص.' }, { status: 409 })
  }

  const by = profile.full_name || profile.email || null
  void runCompanyScan({ trigger: 'manual', by }).catch(() => {
    /* runCompanyScan records its own failure in lastRun */
  })

  return NextResponse.json({ started: true }, { status: 202 })
}
