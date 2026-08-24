// GET /api/quote-terms/override?key=<scope:id> — this quote's T&C override
// PUT /api/quote-terms/override  { key, enabled?, lang?, terms? } — save it
//
// The override lets a single quote turn the T&C on/off, pick its language, and
// replace the bullet lines. Gated by the quote scope's write permission.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission, type PermissionKey } from '@/lib/permissions'
import { getOverride, setOverride } from '@/lib/quote-terms/store'

export const runtime = 'nodejs'

function permFor(key: string): PermissionKey {
  if (key.startsWith('tannoor:')) return 'tannoor.quotation.export'
  if (key.startsWith('manual:')) return 'page.furn'
  return 'furn.quotation.export'
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = new URL(request.url).searchParams.get('key') || ''
  if (!/^(furn|tannoor|manual):/.test(key)) return NextResponse.json({ error: 'مفتاح غير صالح' }, { status: 400 })
  return NextResponse.json({ override: await getOverride(key) })
}

export async function PUT(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: unknown; enabled?: unknown; lang?: unknown; terms?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const key = typeof body.key === 'string' ? body.key : ''
  if (!/^(furn|tannoor|manual):/.test(key)) return NextResponse.json({ error: 'مفتاح غير صالح' }, { status: 400 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, permFor(key))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await setOverride(key, {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    lang: body.lang === 'ar' || body.lang === 'en' ? body.lang : undefined,
    terms: Array.isArray(body.terms) ? (body.terms as string[]) : null,
  })
  return NextResponse.json({ ok: true })
}
