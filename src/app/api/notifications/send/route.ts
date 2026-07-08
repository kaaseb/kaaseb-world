import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { hasPermission, DEFAULT_PERMISSIONS, type PermissionKey } from '@/lib/permissions'
import { sendEmail } from '@/lib/email/send'
import { tplNotification } from '@/lib/email/templates'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { title, message, recipient_id } = await request.json()
    if (!title || !message) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const admin = createAdminClient()

    // Direct messages are open to anyone authenticated. Broadcasts (no
    // recipient — fan out to the whole org) require feature.broadcast so a
    // random employee can't spam everyone.
    if (!recipient_id) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role, custom_role_id')
        .eq('id', user.id)
        .single()

      let permissions: string[] = DEFAULT_PERMISSIONS[profile?.role as 'super_admin' | 'project_manager' | 'employee'] ?? []
      if (profile?.custom_role_id) {
        const { data: customRole } = await admin
          .from('custom_roles')
          .select('permissions')
          .eq('id', profile.custom_role_id)
          .single()
        if (customRole?.permissions) permissions = customRole.permissions as string[]
      }

      if (!hasPermission(profile, permissions, 'feature.broadcast' as PermissionKey)) {
        return NextResponse.json({ error: 'Forbidden — broadcast permission required' }, { status: 403 })
      }
    }

    await admin.from('notifications').insert({
      sender_id: user.id,
      title,
      message,
      recipient_id: recipient_id ?? null,
      is_broadcast: !recipient_id,
    })

    // Mirror the notification to email. Fire-and-forget so a slow SMTP
    // doesn't make the request hang.
    ;(async () => {
      const targets: { email: string; full_name: string | null }[] = []
      if (recipient_id) {
        const { data } = await admin.from('profiles').select('email, full_name').eq('id', recipient_id).single()
        if (data?.email) targets.push(data)
      } else {
        // Broadcast: pull every active profile.
        const { data } = await admin.from('profiles').select('email, full_name').neq('id', user.id)
        for (const p of data ?? []) if (p.email) targets.push(p)
      }
      for (const t of targets) {
        const tpl = tplNotification({ recipientName: t.full_name ?? undefined, title, body: message })
        await sendEmail({ to: t.email, subject: tpl.subject, html: tpl.html })
      }
    })()

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
