import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { sendEmail } from '@/lib/email/send'
import { tplNotification } from '@/lib/email/templates'

// POST /api/email/notification
// Body: { userId: string, title: string, body?: string }
// Sends an email with an arbitrary title/body to any user via company SMTP —
// a spam/phishing primitive if left open. Restricted to super-admins (the only
// role that fans out cross-user notifications) + CSRF. Callers that send to the
// user themselves are unaffected because super-admins can target anyone.
export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'هذا الإجراء للسوبر أدمن فقط.' }, { status: 403 })
  }

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
