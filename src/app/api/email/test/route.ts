import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { tplTest } from '@/lib/email/templates'

// POST /api/email/test
// Body: { to?: string }   — defaults to it@ghassl.com
// Sends a one-shot test email so admins can confirm SMTP works end-to-end.
// Restricted to super-admins so it can't be abused as an open relay.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const to = (typeof body?.to === 'string' && body.to.includes('@'))
    ? body.to
    : 'it@ghassl.com'

  const tpl = tplTest(profile.full_name ?? undefined)
  const ok = await sendEmail({ to, subject: tpl.subject, html: tpl.html })

  if (!ok) return NextResponse.json({ error: 'Send failed' }, { status: 500 })
  return NextResponse.json({ ok: true, to })
}
