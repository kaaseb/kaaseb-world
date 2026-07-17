// POST /api/integrations/titan/test — verify the saved Titan IMAP credentials
// by opening a connection and immediately logging out. Super_admin only.
//
// Exists because Titan's two prerequisites (enable third-party access, disable
// 2FA) are invisible failures otherwise — the user would only find out when a
// scheduled pull silently failed. This turns "did I set Titan up right?" into a
// one-click answer with a specific error.

import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getTitanSettings, decryptTitanPassword } from '@/lib/integrations/titan'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const titan = await getTitanSettings()
  const pass = decryptTitanPassword(titan)
  if (!titan.email || !pass) {
    return NextResponse.json({ error: 'أدخل الإيميل وكلمة المرور واحفظ أولاً.' }, { status: 400 })
  }

  let client: ImapFlow | null = null
  try {
    client = new ImapFlow({
      host: titan.host,
      port: titan.port,
      secure: true,
      auth: { user: titan.email, pass },
      logger: false,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
    await client.connect()
    const lock = await client.getMailboxLock(titan.folder || 'INBOX')
    const count = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox.exists : 0
    lock.release()
    return NextResponse.json({ ok: true, mailbox: titan.folder || 'INBOX', messages: count })
  } catch (e) {
    // Translate the usual Titan gotchas into an actionable message.
    const raw = e instanceof Error ? e.message : String(e)
    let hint = raw
    if (/auth|login|credential|invalid/i.test(raw)) {
      hint = 'فشل تسجيل الدخول. تأكد من الإيميل وكلمة المرور، وأن "Third-party access" مفعّل و2FA متوقّف في Titan.'
    } else if (/timeout|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
      hint = 'تعذّر الوصول لخادم Titan. تأكد من الخادم (imap.titan.email) والمنفذ (993).'
    }
    return NextResponse.json({ error: hint }, { status: 502 })
  } finally {
    if (client) {
      try { await client.logout() } catch { /* ignore */ }
    }
  }
}
