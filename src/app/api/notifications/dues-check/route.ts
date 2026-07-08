import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { NextResponse } from 'next/server'
import { differenceInDays } from 'date-fns'

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    // Only super-admins can trigger the dues sweep — it fans out notifications
    // to all super-admins, so an unprivileged trigger could be used as a
    // notification-spam vector.
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get all super_admins
    const { data: superAdmins } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')

    if (!superAdmins || superAdmins.length === 0) return NextResponse.json({ ok: true })

    // Get all dues with next_payment_date
    const { data: dues } = await admin
      .from('finance_dues')
      .select('id, platform, amount, next_payment_date')
      .not('next_payment_date', 'is', null)

    if (!dues || dues.length === 0) return NextResponse.json({ ok: true })

    const today = new Date()
    const toInsert: object[] = []

    for (const due of dues) {
      const days = differenceInDays(new Date(due.next_payment_date), today)
      let label: string | null = null
      let tag: string | null = null

      if (days === 14) { label = 'خلال أسبوعين'; tag = '14d' }
      else if (days === 7) { label = 'خلال أسبوع'; tag = '7d' }
      else continue

      // Dedup: check if already sent today for this due + tag
      const todayStr = today.toISOString().slice(0, 10)
      const objectId = `dues-${due.id}-${tag}-${todayStr}`

      const { count } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('object_id', objectId)

      if ((count ?? 0) > 0) continue

      for (const sa of superAdmins) {
        toInsert.push({
          sender_id: user.id,
          recipient_id: sa.id,
          is_broadcast: false,
          title: `تنبيه: التزام قادم — ${due.platform}`,
          message: `الالتزام "${due.platform}" يستحق ${label}. المبلغ: ر.س ${due.amount.toLocaleString()}`,
          object_id: objectId,
        })
      }
    }

    if (toInsert.length > 0) {
      await admin.from('notifications').insert(toInsert)
    }

    return NextResponse.json({ ok: true, sent: toInsert.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
