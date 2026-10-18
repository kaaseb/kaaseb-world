// GET  /api/manual-quotes — list
// POST /api/manual-quotes — create a blank quote (number auto-assigned from 100),
//                            or { duplicateOf, subject } → a copy with the next number

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { listManualQuotes, createManualQuote, duplicateManualQuote } from '@/lib/manual-quotes/store'
import { getOverride, setOverride } from '@/lib/quote-terms/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null, profile: null }
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), user: null, profile: null }
  }
  return { error: null, user, profile }
}

export async function GET() {
  const { error } = await guard()
  if (error) return error
  return NextResponse.json({ quotes: await listManualQuotes() })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { error, user, profile } = await guard()
  if (error) return error
  const who = { createdBy: user!.id, createdByName: profile!.full_name || profile!.email || null }

  let body: { duplicateOf?: unknown; subject?: unknown } = {}
  try { body = await request.json() } catch { /* blank create has no body */ }
  if (typeof body.duplicateOf === 'string' && body.duplicateOf) {
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const quote = await duplicateManualQuote(body.duplicateOf, { ...who, subject })
    if (!quote) return NextResponse.json({ error: 'العرض الأصلي غير موجود' }, { status: 404 })
    // The per-quote Terms & Conditions choice travels with the copy.
    try {
      const ov = await getOverride(`manual:${body.duplicateOf}`)
      if (ov) await setOverride(`manual:${quote.id}`, ov)
    } catch { /* terms fall back to the global default */ }
    return NextResponse.json({ quote })
  }
  const quote = await createManualQuote(who)
  return NextResponse.json({ quote })
}
