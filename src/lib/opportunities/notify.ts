// "الفرص" — tell someone when the robot finds something big.
//
// The whole promise of a 3 AM scout is that you DON'T have to check the page.
// Without this, a 95-score lead sits there until somebody remembers to look.
//
// WORKING WITHIN THE EXISTING SCHEMA (deliberately — no migrations):
// `notifications` has exactly 8 columns: id, title, message, sender_id,
// recipient_id, is_broadcast, read_at, created_at.
//   • No `link` column → a notification cannot deep-link. We name the page in
//     the message text instead and let the reader click the sidebar.
//   • No `object_id` column → the synthetic-key dedup that dues-check tries to
//     use does not exist here. We dedup on (title, today) instead, which the
//     schema does support. (Heads-up: dues-check writes object_id and therefore
//     cannot be working in production — separate bug, not ours to fix here.)
//   • `sender_id` is NOT NULL and FKs to profiles → a cron run has no user, so
//     the notification is sent "from" the first super-admin.

import { createAdminClient } from '@/lib/supabase/admin'
import type { Opportunity } from './types'

// Only shout about the ones worth interrupting someone for. Below this the
// daily page visit is enough — an alert for every find trains people to ignore
// alerts, which costs more than it gives.
export const NOTIFY_SCORE_THRESHOLD = 80

const log = (msg: string) => console.log(`[الفرص/إشعار] ${msg}`)

export async function notifyHighValue(found: Opportunity[]): Promise<number> {
  const worthy = found.filter((o) => o.score >= NOTIFY_SCORE_THRESHOLD)
  if (worthy.length === 0) return 0

  try {
    const admin = createAdminClient()

    const { data: superAdmins } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')

    if (!superAdmins || superAdmins.length === 0) return 0

    // No user in a cron context, and sender_id can't be null.
    const senderId = superAdmins[0].id

    const top = [...worthy].sort((a, b) => b.score - a.score)
    const title = `${worthy.length} فرصة قوية جديدة في الفرص`
    const lines = top
      .slice(0, 5)
      .map((o) => `• (${o.score}/100) ${o.title}${o.owner ? ` — ${o.owner}` : ''}`)
    const message = [
      ...lines,
      worthy.length > 5 ? `\nو ${worthy.length - 5} غيرها.` : '',
      '\nافتح صفحة "الفرص" لتفاصيلها وجهات التواصل.',
    ]
      .filter(Boolean)
      .join('\n')

    // Dedup: never send the same headline twice in one day. Two scans in one
    // day (the 3 AM tick plus a manual click) must not double-notify.
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const { count } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('title', title)
      .gte('created_at', since.toISOString())

    if ((count ?? 0) > 0) {
      log(`skipped — "${title}" already sent today`)
      return 0
    }

    const rows = superAdmins.map((sa) => ({
      sender_id: senderId,
      recipient_id: sa.id,
      is_broadcast: false,
      title,
      message,
    }))

    const { error } = await admin.from('notifications').insert(rows)
    if (error) {
      log(`insert failed: ${error.message}`)
      return 0
    }

    log(`sent to ${rows.length} admin(s) — ${worthy.length} high-value find(s)`)
    return rows.length
  } catch (e) {
    // A notification failing must never fail the scan that produced the data.
    log(`failed: ${e instanceof Error ? e.message : String(e)}`)
    return 0
  }
}
