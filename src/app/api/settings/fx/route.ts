// GET  /api/settings/fx — read the USD exchange-rate setting
// PATCH /api/settings/fx — update it (super_admin only)
//
// Not a secret (a rate isn't sensitive), so GET is open to any signed-in user —
// the Tannoor pages need it to render prices. Only PATCH is gated.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getFxSettings, setFxSettings, type FxMode } from '@/lib/settings/fx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODES: FxMode[] = ['manual', 'rate_375', 'rate_380', 'custom']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ fx: await getFxSettings() })
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

  let body: { mode?: unknown; customRate?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  const patch: { mode?: FxMode; customRate?: number; updatedBy: string | null } = {
    updatedBy: profile.full_name || profile.email || null,
  }
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode as FxMode)) {
      return NextResponse.json({ error: 'وضع غير صالح' }, { status: 400 })
    }
    patch.mode = body.mode as FxMode
  }
  if (body.customRate !== undefined) {
    const n = Number(body.customRate)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'سعر صرف غير صالح' }, { status: 400 })
    }
    patch.customRate = n
  }

  const fx = await setFxSettings(patch)
  return NextResponse.json({ fx })
}
