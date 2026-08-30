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
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const toInsert: object[] = []

    for (const due of dues) {
      const days = differenceInDays(new Date(due.next_payment_date), today)
      let label: string
      if (days === 14) label = 'خلال أسبوعين'
      else if (days === 7) label = 'خلال أسبوع'
      else continue

      // The `notifications` table has NO `object_id` column (see
      // src/lib/opportunities/notify.ts), so dedup on (title, created today) —
      // the same key the docs-expiry sweep uses. `title` encodes the due +
      // window so re-triggering the sweep on the same day never double-sends.
      const title = `تنبيه: التزام "${due.platform}" يستحق ${label}`
      const message = `الالتزام "${due.platform}" يستحق ${label}. المبلغ: ر.س ${due.amount.toLocaleString()}`

      const { count } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('title', title)
        .gte('created_at', todayStart)

      if ((count ?? 0) > 0) continue

      for (const sa of superAdmins) {
        toInsert.push({ sender_id: user.id, recipient_id: sa.id, is_broadcast: false, title, message })
      }
    }

    if (toInsert.length > 0) {
      const { error } = await admin.from('notifications').insert(toInsert)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, sent: toInsert.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
