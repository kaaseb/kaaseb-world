// GET  /api/quote-terms — the global bilingual T&C default (any authed user).
// POST /api/quote-terms — save it (super-admin).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getGlobalTerms, setGlobalTerms, type GlobalTerms } from '@/lib/quote-terms/store'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ terms: await getGlobalTerms() })
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
  let body: { terms?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const t = body?.terms as GlobalTerms | undefined
  if (!t || typeof t !== 'object') return NextResponse.json({ error: 'قالب غير صالح' }, { status: 400 })
  return NextResponse.json({ ok: true, terms: await setGlobalTerms(t) })
}
