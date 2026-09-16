// GET /api/admin/health — is the heavy worker pool alive on THIS server?
//
// The pool falls back in-process when it cannot start (the app keeps working,
// only the "hang" protection is lost). That fallback is logged once; this
// endpoint lets a super-admin see it without shell access to the server.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback } from '@/lib/profile'
import { heavy, heavyPoolStatus } from '@/lib/heavy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // A live probe: a 3-byte hash goes through the pool (or the fallback).
  const t0 = Date.now()
  let probe: { ok: boolean; ms: number; error?: string }
  try {
    const h = await heavy.sha256(new Uint8Array([1, 2, 3]))
    probe = { ok: h === '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', ms: Date.now() - t0 }
  } catch (e) {
    probe = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
  }
  return NextResponse.json({
    node: process.version,
    cwd: process.cwd(),
    pool: heavyPoolStatus(),
    probe,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  })
}
