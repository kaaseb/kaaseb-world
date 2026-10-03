// GET /api/admin/health — is the heavy worker pool alive on THIS server?
//
// The pool falls back in-process when it cannot start (the app keeps working,
// only the "hang" protection is lost). That fallback is logged once; this
// endpoint lets a super-admin see it without shell access to the server.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback } from '@/lib/profile'
import { heavy, heavyPoolStatus } from '@/lib/heavy'
import { renderHtmlToPdf } from '@/lib/html-pdf'
import { resolveMailer } from '@/lib/outreach/transport'

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
  // Can this server render a PDF at all? (Chromium + its shared libraries.)
  const t1 = Date.now()
  let pdf: { ok: boolean; ms: number; error?: string }
  try {
    const out = await renderHtmlToPdf('<html><body><p>health</p></body></html>')
    pdf = { ok: out.byteLength > 500, ms: Date.now() - t1 }
  } catch (e) {
    pdf = { ok: false, ms: Date.now() - t1, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) }
  }
  // Is an outgoing mail account configured and reachable?
  const t2 = Date.now()
  let mail: { ok: boolean; ms: number; from?: string; error?: string }
  try {
    const m = await resolveMailer()
    await m.transport.verify()
    mail = { ok: true, ms: Date.now() - t2, from: String(m.from || '') }
  } catch (e) {
    mail = { ok: false, ms: Date.now() - t2, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }

  return NextResponse.json({
    pdf,
    mail,
    node: process.version,
    cwd: process.cwd(),
    pool: heavyPoolStatus(),
    probe,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  })
}
