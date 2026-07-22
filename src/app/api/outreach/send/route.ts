// POST /api/outreach/send — send the outreach mail to ONE opportunity or target
// company, then stamp it "contacted" so it leaves the working list.
//
// This is the only route in the app that mails a THIRD PARTY, so it is
// deliberately narrow and defensive:
//   • one recipient per call — there is no mass-send surface here;
//   • already-'contacted' records are refused, so a double click (or a second
//     tab) can't mail the same customer twice;
//   • the address must parse as an email before the transport is even opened;
//   • permission is checked per feature (page.opportunities / page.companies);
//   • the status is only advanced AFTER the send succeeds — a failed send must
//     never hide the lead from the team.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { serverAudit } from '@/lib/audit-server'
import { getOpportunity, updateOpportunity } from '@/lib/opportunities/store'
import { getCompany, updateCompany } from '@/lib/companies/store'
import { getOutreachTemplate, renderOutreach } from '@/lib/outreach/store'
import { sendOutreachEmail, isEmail } from '@/lib/outreach/send'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { type?: unknown; id?: unknown; to?: unknown; subject?: unknown; body?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const type = body.type === 'company' ? 'company' : body.type === 'opportunity' ? 'opportunity' : null
  const id = typeof body.id === 'string' ? body.id : ''
  if (!type || !id) return NextResponse.json({ error: 'type و id مطلوبان' }, { status: 400 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  const page = type === 'company' ? 'page.companies' : 'page.opportunities'
  if (!hasPermission(profile, permissions, page)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── resolve the record + its recipient ──────────────────────────────────────
  const record = type === 'company' ? await getCompany(id) : await getOpportunity(id)
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (record.status === 'contacted') {
    return NextResponse.json({ error: 'تم التواصل معهم مسبقاً — لن يُرسل مرة ثانية.' }, { status: 409 })
  }

  const contacts = Array.isArray(record.contacts) ? record.contacts : []
  const firstWithEmail = contacts.find((c) => isEmail(c.email || ''))
  const to = (typeof body.to === 'string' && body.to.trim()) || firstWithEmail?.email || ''
  if (!isEmail(to)) {
    return NextResponse.json({ error: 'ما فيه بريد صالح لهذا السجل — أضف جهة اتصال أولاً.' }, { status: 400 })
  }

  // ── build the message (caller may override subject/body for this send) ──────
  const tpl = await getOutreachTemplate()
  const isCompany = type === 'company'
  const vars: Record<string, string> = {
    contact: firstWithEmail?.name || '',
    company: isCompany
      ? (record as { name: string }).name
      : (record as { owner: string }).owner,
    project: isCompany ? '' : (record as { title: string }).title,
    city: (record as { city?: string }).city || '',
  }

  const subject = renderOutreach(
    (typeof body.subject === 'string' && body.subject.trim()) || tpl.subject,
    vars,
  ).slice(0, 300)
  const text = renderOutreach(
    (typeof body.body === 'string' && body.body.trim()) || tpl.body,
    vars,
  ).slice(0, 20000)

  // ── send, THEN mark contacted ───────────────────────────────────────────────
  let attached = false
  try {
    const res = await sendOutreachEmail({
      to,
      subject,
      body: text,
      profileUrl: tpl.profileUrl,
      profileName: tpl.profileName,
      replyTo: profile.email || null,
    })
    attached = res.attached
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'فشل الإرسال'
    return NextResponse.json({ error: `تعذّر الإرسال: ${msg}` }, { status: 502 })
  }

  const stampedNote = `📧 أُرسل التعريف إلى ${to} — ${new Date().toISOString().slice(0, 10)} بواسطة ${profile.full_name || profile.email || 'مستخدم'}`
  const notes = [record.notes, stampedNote].filter(Boolean).join('\n')

  if (isCompany) await updateCompany(id, { status: 'contacted', notes })
  else await updateOpportunity(id, { status: 'contacted', notes })

  await serverAudit({
    user, supabase, action: 'edit',
    objectType: isCompany ? 'target_company' : 'opportunity',
    objectName: vars.company, objectId: id,
  })

  return NextResponse.json({ ok: true, to, attached })
}
