// GET   /api/integrations/titan — masked Titan settings (password → boolean)
// PATCH /api/integrations/titan — update (super_admin only), password encrypted
//
// Mirrors /api/ai/settings: CSRF + super_admin gate on write, never returns the
// password. See src/lib/integrations/titan.ts for the storage/encryption.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getTitanSettings, setTitanSettings, toPublicTitan } from '@/lib/integrations/titan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ titan: toPublicTitan(await getTitanSettings()) })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    enabled?: unknown; host?: unknown; port?: unknown
    email?: unknown; password?: unknown; folder?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  const patch: Parameters<typeof setTitanSettings>[0] = {
    updatedBy: profile.full_name || profile.email || null,
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.host === 'string') patch.host = body.host
  if (body.port !== undefined) {
    const p = Number(body.port)
    if (Number.isFinite(p) && p > 0) patch.port = p
  }
  if (typeof body.email === 'string') patch.email = body.email
  if (typeof body.password === 'string') patch.password = body.password // '' clears
  if (typeof body.folder === 'string') patch.folder = body.folder

  const titan = await setTitanSettings(patch)
  return NextResponse.json({ titan: toPublicTitan(titan) })
}
