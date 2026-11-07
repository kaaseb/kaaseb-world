// POST /api/campaigns/stone-2026/copy-to-sent — file copies of the companies
// that were emailed BEFORE copies were kept, in info@'s «Sent» folder.
//
// Sends NOTHING to anyone: IMAP append into our own mailbox only. Each copy is
// rebuilt from the saved campaign message for that company, to the same
// addresses, with the original send date. Works in small batches (the request
// has a time limit); the page calls it again until `remaining` is 0. A company
// is marked only after its copy is actually filed, so a retry never duplicates.

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { campaignAccess } from '@/lib/campaigns/access'
import { getCampaignState, missingSentCopies, markCopied } from '@/lib/campaigns/store'
import { TARGETS, DEFAULT_SUBJECT, DEFAULT_BODY, varsFor, fill } from '@/lib/campaigns/stone-2026'
import { getOutreachTemplate } from '@/lib/outreach/store'
import { profileAttachment, textToHtml } from '@/lib/outreach/send'
import { fileCopiesInSent, explainMailError } from '@/lib/outreach/transport'

export const runtime = 'nodejs'
export const maxDuration = 60

const BATCH = 4

export async function POST(request: Request) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const a = await campaignAccess()
  if ('error' in a) return a.error

  const [state, tpl] = await Promise.all([getCampaignState(), getOutreachTemplate()])
  const ids = missingSentCopies(state).filter((id) => TARGETS.some((t) => t.id === id))
  const batch = ids.slice(0, BATCH)
  if (!batch.length) return NextResponse.json({ ok: true, filed: 0, failed: 0, remaining: 0 })

  try {
    const profile = await profileAttachment(tpl.profileUrl, tpl.profileName)
    const results = await fileCopiesInSent(async (from) => batch.map((id) => {
      const t = TARGETS.find((x) => x.id === id)!
      const rec = state.sent[id]
      const vars = varsFor(t)
      const text = fill(state.body ?? DEFAULT_BODY, vars)
      return {
        from, to: rec.to.join(', '), replyTo: a.email || undefined,
        subject: fill(state.subject ?? DEFAULT_SUBJECT, vars).slice(0, 300),
        text, html: textToHtml(text),
        attachments: rec.attached ? profile : [],
        date: new Date(rec.at),
      }
    }))
    const done = batch.filter((_, i) => results[i])
    await markCopied(done)
    const failed = batch.length - done.length
    return NextResponse.json({ ok: true, filed: done.length, failed, remaining: failed ? 0 : ids.length - done.length })
  } catch (e) {
    return NextResponse.json({ error: `تعذّر الحفظ في «المرسل»: ${explainMailError(e)}` }, { status: 502 })
  }
}
