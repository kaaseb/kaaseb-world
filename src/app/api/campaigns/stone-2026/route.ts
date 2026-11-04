// GET   /api/campaigns/stone-2026 — targets, message, profile, what was sent
// PATCH /api/campaigns/stone-2026 — { subject, body } the owner's edits (null = back to default)

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { campaignAccess } from '@/lib/campaigns/access'
import { getCampaignState, saveCampaignText } from '@/lib/campaigns/store'
import { TARGETS, DEFAULT_SUBJECT, DEFAULT_BODY } from '@/lib/campaigns/stone-2026'
import { getOutreachTemplate } from '@/lib/outreach/store'
import { fetchAppOwned } from '@/lib/s3'

export const runtime = 'nodejs'

export async function GET() {
  const a = await campaignAccess()
  if ('error' in a) return a.error
  const [state, tpl] = await Promise.all([getCampaignState(), getOutreachTemplate()])
  // Is the profile really downloadable? A message "with the profile attached"
  // must not go out bare.
  let profileOk = false
  if (tpl.profileUrl) {
    try { profileOk = (await fetchAppOwned(tpl.profileUrl)).ok } catch { profileOk = false }
  }
  return NextResponse.json({
    targets: TARGETS,
    subject: state.subject ?? DEFAULT_SUBJECT,
    body: state.body ?? DEFAULT_BODY,
    edited: state.subject !== null || state.body !== null,
    sent: state.sent,
    failed: state.failed,
    profile: { url: tpl.profileUrl, name: tpl.profileName, ok: profileOk },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const a = await campaignAccess()
  if ('error' in a) return a.error
  let body: { subject?: unknown; body?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.slice(0, 300) : null
  const text = typeof body.body === 'string' && body.body.trim() ? body.body.slice(0, 20000) : null
  await saveCampaignText(subject, text)
  return NextResponse.json({ ok: true })
}
