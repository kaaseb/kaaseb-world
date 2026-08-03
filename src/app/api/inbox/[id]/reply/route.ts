// POST /api/inbox/[id]/reply — email the customer back through the Titan account,
// threaded under their message. Body: { language: 'ar'|'en', subject?, body }.
// Used for the "we're preparing your quotation" acknowledgment AND any free-form
// message the team wants to send.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getEmail, getThreadEmails, setThreadReplied } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { sendReply, messageIdHeader } from '@/lib/inbox/reply'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!email.fromEmail) return NextResponse.json({ error: 'ما فيه بريد للمُرسِل — لا يمكن الرد.' }, { status: 400 })

  let body: { language?: unknown; subject?: unknown; body?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const language = body.language === 'en' ? 'en' : 'ar'
  const subject = (typeof body.subject === 'string' && body.subject.trim())
    ? body.subject.trim().slice(0, 300)
    : `Re: ${email.subject || ''}`.slice(0, 300)
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 20000) : ''
  if (!text) return NextResponse.json({ error: 'الرسالة فارغة' }, { status: 400 })

  // Thread the reply: In-Reply-To the latest message, References the whole chain.
  const thread = await getThreadEmails(email.threadId)
  const chain = thread.length ? thread : [email]
  const latest = chain[chain.length - 1]
  const inReplyTo = messageIdHeader(latest.id)
  const references = chain.map((e) => messageIdHeader(e.id)).filter(Boolean).join(' ') || inReplyTo

  try {
    await sendReply({
      to: email.fromEmail,
      subject,
      text,
      inReplyTo,
      references,
      replyTo: profile.email || null,
      dir: language === 'ar' ? 'rtl' : 'ltr',
    })
  } catch (e) {
    return NextResponse.json({ error: `تعذّر الإرسال: ${e instanceof Error ? e.message : 'فشل'}` }, { status: 502 })
  }

  const now = new Date().toISOString()
  await setThreadReplied(email.threadId, now)
  return NextResponse.json({ ok: true, repliedAt: now })
}
