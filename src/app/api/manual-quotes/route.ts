// GET  /api/manual-quotes — list
// POST /api/manual-quotes — create a blank quote (number auto-assigned from 100)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { listManualQuotes, createManualQuote } from '@/lib/manual-quotes/store'

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
  const quote = await createManualQuote({
    createdBy: user!.id,
    createdByName: profile!.full_name || profile!.email || null,
  })
  return NextResponse.json({ quote })
}
