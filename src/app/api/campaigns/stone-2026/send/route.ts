// POST /api/campaigns/stone-2026/send — { targetId, emails } → ONE email to that company.
//
// Safety: super admin only; recipients must be addresses of THAT company from
// the campaign list (no free-form addresses); the company is claimed before
// sending so a double click / second tab can't mail it twice; the profile must
// be attachable or nothing is sent; the text is the saved campaign message,
// filled for this company, and refused if a {{placeholder}} is left.

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { serverAudit } from '@/lib/audit-server'
import { campaignAccess } from '@/lib/campaigns/access'
import { getCampaignState, claimTarget, finishTarget, failTarget } from '@/lib/campaigns/store'
import { TARGETS, DEFAULT_SUBJECT, DEFAULT_BODY, varsFor, fill, hasUnfilled } from '@/lib/campaigns/stone-2026'
import { getOutreachTemplate } from '@/lib/outreach/store'
import { sendOutreachEmail } from '@/lib/outreach/send'
import { explainMailError } from '@/lib/outreach/transport'
import { fetchAppOwned } from '@/lib/s3'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const a = await campaignAccess()
  if ('error' in a) return a.error

  let body: { targetId?: unknown; emails?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const target = TARGETS.find((t) => t.id === body.targetId)
  if (!target) return NextResponse.json({ error: 'شركة غير موجودة في الحملة' }, { status: 404 })

  const allowed = new Map(target.emails.map((e) => [e.email.toLowerCase(), e.email]))
  const to = (Array.isArray(body.emails) ? body.emails : [])
    .map((e) => (typeof e === 'string' ? allowed.get(e.trim().toLowerCase()) : undefined))
    .filter((e): e is string => !!e)
  if (!to.length) return NextResponse.json({ error: 'اختر إيميل واحد على الأقل لهذه الشركة' }, { status: 400 })

  const [state, tpl] = await Promise.all([getCampaignState(), getOutreachTemplate()])
  if (state.sent[target.id]) return NextResponse.json({ error: 'تم الإرسال لهذه الشركة من قبل', alreadySent: true }, { status: 409 })

  if (!tpl.profileUrl) return NextResponse.json({ error: 'البروفايل غير مرفوع — ارفعه من الإعدادات ← التواصل' }, { status: 400 })
  try {
    if (!(await fetchAppOwned(tpl.profileUrl)).ok) throw new Error()
  } catch {
    return NextResponse.json({ error: 'تعذّر تحميل البروفايل — ما أُرسل شيء. تأكد من الملف في الإعدادات ← التواصل' }, { status: 502 })
  }

  const vars = varsFor(target)
  const subject = fill(state.subject ?? DEFAULT_SUBJECT, vars).slice(0, 300)
  const text = fill(state.body ?? DEFAULT_BODY, vars)
  if (hasUnfilled(subject) || hasUnfilled(text)) {
    return NextResponse.json({ error: 'في الرسالة متغيّر غير معروف بين {{ }} — صحّحه قبل الإرسال' }, { status: 400 })
  }

  if (!(await claimTarget(target.id, a.name))) {
    return NextResponse.json({ error: 'تم الإرسال لهذه الشركة من قبل', alreadySent: true }, { status: 409 })
  }
  try {
    const res = await sendOutreachEmail({ to, subject, body: text, profileUrl: tpl.profileUrl, profileName: tpl.profileName, replyTo: a.email })
    const rec = { at: new Date().toISOString(), by: a.name, to, attached: res.attached }
    await finishTarget(target.id, rec)
    const supabase = await createClient()
    await serverAudit({ user: { id: a.userId, email: a.email ?? undefined }, supabase, action: 'edit', objectType: 'campaign', objectName: `حملة المشاريع → ${target.company_ar} (${to.join('، ')})`, objectId: target.id }).catch(() => {})
    return NextResponse.json({ ok: true, sent: rec })
  } catch (e) {
    const why = explainMailError(e)
    await failTarget(target.id, why)
    return NextResponse.json({ error: `تعذّر الإرسال: ${why}` }, { status: 502 })
  }
}
