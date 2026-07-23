// POST /api/outreach/broadcast — send ONE general "about KAASEB" message to a
// pasted/uploaded list of addresses.
//
// The single highest-blast-radius action in the app, so it is the most locked
// down: SUPER-ADMIN ONLY, list validated + de-duped + hard-capped, recipients
// sent BCC (never exposed to each other), and every run is audited with the
// exact count. The message text is whatever the admin typed — no per-record
// placeholders here.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { serverAudit } from '@/lib/audit-server'
import { getOutreachTemplate } from '@/lib/outreach/store'
import { parseEmailList, sendBroadcast, BROADCAST_MAX } from '@/lib/outreach/broadcast'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'الإرسال الجماعي للسوبر أدمن فقط.' }, { status: 403 })
  }

  let body: { subject?: unknown; body?: unknown; emails?: unknown; attachProfile?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 300) : ''
  const text = typeof body.body === 'string' ? body.body.slice(0, 20000) : ''
  if (!subject || !text) return NextResponse.json({ error: 'الموضوع والنص مطلوبان' }, { status: 400 })

  // Accept a raw paste (string) or an already-split array — either way it's
  // re-parsed and validated here; the client's count is never trusted.
  const raw = Array.isArray(body.emails) ? body.emails.join('\n') : typeof body.emails === 'string' ? body.emails : ''
  const { valid, invalid, duplicates } = parseEmailList(raw)
  if (valid.length === 0) {
    return NextResponse.json({ error: 'ما فيه عناوين بريد صالحة في القائمة.' }, { status: 400 })
  }

  const tpl = await getOutreachTemplate()
  const attachProfile = body.attachProfile !== false // default: attach

  let result
  try {
    result = await sendBroadcast({
      subject,
      body: text,
      emails: valid,
      attachProfile,
      profileUrl: tpl.profileUrl,
      profileName: tpl.profileName,
      replyTo: profile.email || null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'فشل الإرسال' }, { status: 502 })
  }

  await serverAudit({
    user, supabase, action: 'add', objectType: 'outreach_broadcast',
    objectName: `${result.sent} مستلِم — ${subject}`.slice(0, 200),
  })

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    failed: result.failed,
    invalid,
    duplicates,
    attached: result.attached,
    cap: BROADCAST_MAX,
  })
}
