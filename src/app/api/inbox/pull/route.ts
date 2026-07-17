// POST /api/inbox/pull — manual "pull now". Fire-and-forget + poll, like the
// opportunities scan. IMAP + 200 attachments takes a while.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getInboxState } from '@/lib/inbox/store'
import { runPull } from '@/lib/inbox/imap'

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
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { lastRun } = await getInboxState()
  if (lastRun?.status === 'running') {
    return NextResponse.json({ error: 'السحب شغّال حالياً — انتظر لين يخلص.' }, { status: 409 })
  }

  const by = profile.full_name || profile.email || null
  void runPull({ trigger: 'manual', by }).catch(() => {
    /* runPull records its own failure in lastRun */
  })

  return NextResponse.json({ started: true }, { status: 202 })
}
