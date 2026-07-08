// POST /api/prequal/override — set a per-packet cover/back override.
// Body: { pqId, cover_url?, back_url? } (null/empty falls back to the default).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { setPreQualOverride } from '@/lib/prequal/store'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pqId?: string; cover_url?: string | null; back_url?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.pqId) return NextResponse.json({ error: 'pqId required' }, { status: 400 })

  await setPreQualOverride(body.pqId, {
    cover_url: body.cover_url ? String(body.cover_url) : null,
    back_url: body.back_url ? String(body.back_url) : null,
  })
  return NextResponse.json({ ok: true })
}
