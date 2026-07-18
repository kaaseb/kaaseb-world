// POST /api/inbox/pull — manual "refresh list". Fire-and-forget + poll. This is
// the LIGHT tier: it mirrors envelopes only (subject/from/date/count) for the
// whole recent mailbox — no attachments, no AI. Downloading a message's files
// happens later, per pick, via /api/inbox/[id]/hydrate.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getInboxState } from '@/lib/inbox/store'
import { runList } from '@/lib/inbox/imap'

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
    return NextResponse.json({ error: 'التحديث شغّال حالياً — انتظر لين يخلص.' }, { status: 409 })
  }

  const by = profile.full_name || profile.email || null
  void runList({ trigger: 'manual', by }).catch(() => {
    /* runList records its own failure in lastRun */
  })

  return NextResponse.json({ started: true }, { status: 202 })
}
