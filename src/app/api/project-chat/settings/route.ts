// GET  /api/project-chat/settings — is project chat enabled? (any authed user)
// POST /api/project-chat/settings — enable/disable it (super-admin only)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getProjectChatEnabled, setProjectChatEnabled } from '@/lib/project-chats/settings'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ enabled: await getProjectChatEnabled() })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'هذا الإجراء للسوبر أدمن فقط.' }, { status: 403 })
  }
  let body: { enabled?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  await setProjectChatEnabled(!!body.enabled)
  return NextResponse.json({ ok: true, enabled: !!body.enabled })
}
