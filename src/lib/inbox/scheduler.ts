// Periodic Titan pull — the safety net behind the manual "Pull now" button.
//
// Same in-process node-cron shape as lib/opportunities/scheduler.ts (see it for
// the full rationale): ships with git push, no server access, no secrets. Runs
// every few hours so a customer email doesn't sit unseen until someone clicks —
// but it's cheap (IMAP + dedup, no AI), so "every few hours" costs almost
// nothing. OPPORTUNITIES_INBOX=off disables it; it's off outside production
// unless OPPORTUNITIES_INBOX=on.

import cron from 'node-cron'
import { getTitanSettings } from '@/lib/integrations/titan'
import { getInboxState, lastSuccessfulPullAt } from './store'
import { runList } from './imap'

const CRON_EXPRESSION = '15 */3 * * *' // every 3 hours, offset off the hour
const TIMEZONE = 'Asia/Riyadh'
const BOOT_DELAY_MS = 60 * 1000
const MISSED_AFTER_MS = 6 * 60 * 60 * 1000 // catch up if no successful pull in 6h
const COOLDOWN_MS = 60 * 60 * 1000

const globalRef = globalThis as unknown as { __kaasebInboxCron?: boolean }

function enabled(): boolean {
  const flag = (process.env.OPPORTUNITIES_INBOX || '').toLowerCase()
  if (flag === 'off') return false
  if (flag === 'on') return true
  return process.env.NODE_ENV === 'production'
}

// Don't even connect if Titan was never configured — no point waking IMAP for a
// mailbox that doesn't exist yet.
async function titanReady(): Promise<boolean> {
  try {
    const t = await getTitanSettings()
    return t.enabled && !!t.email && !!t.password
  } catch {
    return false
  }
}

async function shouldCatchUp(): Promise<boolean> {
  const { lastRun } = await getInboxState()
  if (lastRun?.status === 'running') return false
  if (lastRun && Date.now() - new Date(lastRun.startedAt).getTime() < COOLDOWN_MS) return false
  const last = await lastSuccessfulPullAt()
  if (!last) return true
  return Date.now() - last.getTime() > MISSED_AFTER_MS
}

export function startInboxScheduler(): void {
  if (globalRef.__kaasebInboxCron) return
  if (!enabled()) return
  globalRef.__kaasebInboxCron = true

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      void (async () => {
        if (await titanReady()) await runList({ trigger: 'schedule' }).catch(() => {})
      })()
    },
    { timezone: TIMEZONE },
  )

  setTimeout(() => {
    void (async () => {
      try {
        if ((await titanReady()) && (await shouldCatchUp())) await runList({ trigger: 'schedule' })
      } catch {
        /* the safety net must never take the server down */
      }
    })()
  }, BOOT_DELAY_MS).unref?.()

  console.log(`[صندوق] periodic pull scheduled — ${CRON_EXPRESSION} (${TIMEZONE})`)
}
