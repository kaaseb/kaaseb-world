// POST /api/notifications/docs-expiry-check — sweep important documents and
// notify the super-admins about ones nearing (or past) their expiry date.
//
// Mirrors the dues-check sweep, with two deliberate differences forced by the
// real `notifications` schema (8 columns, NO `object_id` — see
// src/lib/opportunities/notify.ts):
//   • Dedup is on (title, created today), not object_id, so re-triggering on the
//     same day never double-sends.
//   • sender_id is NOT NULL → the alert is sent "from" the first super-admin.
//
// Fires on three thresholds per document: 30 days out, 7 days out, and the day
// it expires. Triggered client-side from the dashboard (like dues-check), so no
// external cron is required.

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { NextResponse } from 'next/server'
import { differenceInCalendarDays } from 'date-fns'

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    // Only super-admins can trigger the sweep — it fans out notifications to all
    // super-admins, so an unprivileged trigger would be a spam vector.
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (callerProfile?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: superAdmins } = await admin.from('profiles').select('id').eq('role', 'super_admin')
    if (!superAdmins || superAdmins.length === 0) return NextResponse.json({ ok: true })
    const sender = superAdmins[0].id

    const { data: documents } = await admin
      .from('important_documents')
      .select('id, name_en, name_ar, expiry_date')
      .not('expiry_date', 'is', null)
    if (!documents || documents.length === 0) return NextResponse.json({ ok: true })

    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const toInsert: object[] = []

    for (const doc of documents) {
      const days = differenceInCalendarDays(new Date(doc.expiry_date as string), today)
      let label: string
      if (days === 30) label = 'خلال 30 يوماً'
      else if (days === 7) label = 'خلال 7 أيام'
      else if (days === 0) label = 'اليوم'
      else continue

      const name = doc.name_ar || doc.name_en || 'وثيقة'
      const title = days === 0
        ? `⚠️ انتهاء صلاحية وثيقة اليوم — ${name}`
        : `⏰ اقتراب انتهاء صلاحية وثيقة — ${name}`
      const message = `الوثيقة «${name}» تنتهي صلاحيتها ${label} (${new Date(doc.expiry_date as string).toLocaleDateString('en-GB')}). راجعها من صفحة الأوراق المهمة.`

      // Dedup: skip if the same title was already emitted today (schema has no
      // object_id, so we key on title + created_at like the opportunities notifier).
      const { count } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('title', title)
        .gte('created_at', todayStart)
      if ((count ?? 0) > 0) continue

      for (const sa of superAdmins) {
        toInsert.push({
          sender_id: sender,
          recipient_id: sa.id,
          is_broadcast: false,
          title,
          message,
        })
      }
    }

    if (toInsert.length > 0) await admin.from('notifications').insert(toInsert)
    return NextResponse.json({ ok: true, sent: toInsert.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
