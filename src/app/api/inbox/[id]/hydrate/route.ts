// POST /api/inbox/[id]/hydrate — "جهّز الملخص" for one listed email.
//
// The second tier of the two-tier intake: the LIST sync only mirrored envelopes,
// so this is where a message the owner PICKS gets its attachments downloaded to
// S3 and its stage-1 AI summary produced. Synchronous (one message, bounded) and
// returns the fully hydrated record so the card can update in place.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { hydrateEmail } from '@/lib/inbox/imap'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { id } = await params
  const result = await hydrateEmail(id)
  if (!result.ok || !result.email) {
    return NextResponse.json({ error: result.error || 'فشل إحضار الرسالة.' }, { status: 502 })
  }
  return NextResponse.json({ email: result.email })
}
