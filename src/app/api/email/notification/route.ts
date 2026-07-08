import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { tplNotification } from '@/lib/email/templates'

// POST /api/email/notification
// Body: { userId: string, title: string, body?: string }
// Fired alongside an in-app notification insert so the user gets pinged
// even when not looking at the app.
//
// Restricted to authenticated users. We don't enforce that the caller
// equals the originator of the notification — it's used by server-side
// notification senders (the existing notifications/send route, dues-check,
// etc.) which already gate themselves.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId, title, body } = await request.json().catch(() => ({}))
  if (!userId || !title) {
    return NextResponse.json({ error: 'userId, title required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('profiles').select('email, full_name').eq('id', userId).single()
  if (!target?.email) return NextResponse.json({ error: 'no email' }, { status: 404 })

  const tpl = tplNotification({
    recipientName: target.full_name ?? undefined,
    title,
    body: body ?? null,
  })
  const ok = await sendEmail({ to: target.email, subject: tpl.subject, html: tpl.html })
  return NextResponse.json({ ok })
}
