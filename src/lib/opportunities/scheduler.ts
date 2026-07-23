// "الفرص" — the 3 AM alarm clock.
//
// WHY IN-PROCESS AND NOT OS CRON: this app runs as a single long-lived Node
// server on the VM (next start, behind nginx) — the same reason the visualize
// renders can be fire-and-forget. Scheduling inside that process means the
// whole feature ships with `git push` and needs ZERO server access: no crontab
// to install, no CRON_SECRET to provision, no publicly-callable endpoint to
// protect. Fewer moving parts = fewer ways to break the site.
//
// The one weakness of in-process cron — a restart can straddle the 03:00 tick
// and silently skip a day — is covered by the boot catch-up below.
//
// Kill switch: set OPPORTUNITIES_CRON=off to disable it entirely without a
// code change. Set OPPORTUNITIES_CRON=on to also run it in development (off by
// default there, so nobody burns API credit while coding).

import cron from 'node-cron'
import { getState, lastSuccessfulRunAt } from './store'
import { runScan } from './search'
import { getCompaniesState, lastSuccessfulCompanyRunAt } from '@/lib/companies/store'
import { runCompanyScan } from '@/lib/companies/search'
import { getAutoScan } from '@/lib/scout/auto'

// 03:00 every day, Riyadh time — node-cron does the DST/offset maths for us.
const CRON_EXPRESSION = '0 3 * * *'
// The account list runs half an hour later so the two scans never share a
// tokens-per-minute window. Same reason the sectors inside a scan are spaced.
const COMPANIES_CRON_EXPRESSION = '30 3 * * *'
const TIMEZONE = 'Asia/Riyadh'

// Give the server a moment to finish booting before a catch-up scan.
const BOOT_DELAY_MS = 45 * 1000

// A day without a successful scan means we missed a tick.
const MISSED_AFTER_MS = 24 * 60 * 60 * 1000

// Never re-scan within an hour of the previous attempt, however it ended. This
// is what stops a crash-restart loop from hammering (and billing) the API.
const COOLDOWN_MS = 60 * 60 * 1000

// Next may evaluate this module more than once (dev HMR, multiple entrypoints).
// A global flag guarantees exactly one live schedule per process.
const globalRef = globalThis as unknown as { __kaasebOpportunityCron?: boolean }

function enabled(): boolean {
  const flag = (process.env.OPPORTUNITIES_CRON || '').toLowerCase()
  if (flag === 'off') return false
  if (flag === 'on') return true
  return process.env.NODE_ENV === 'production'
}

// Did we miss a day? Runs at most one make-up scan per boot.
async function shouldCatchUp(): Promise<boolean> {
  const { lastRun } = await getState()
  if (lastRun?.status === 'running') return false
  if (lastRun && Date.now() - new Date(lastRun.startedAt).getTime() < COOLDOWN_MS) return false

  const last = await lastSuccessfulRunAt()
  if (!last) return true // never scanned — get the team some data now
  return Date.now() - last.getTime() > MISSED_AFTER_MS
}

async function shouldCatchUpCompanies(): Promise<boolean> {
  const { lastRun } = await getCompaniesState()
  if (lastRun?.status === 'running') return false
  if (lastRun && Date.now() - new Date(lastRun.startedAt).getTime() < COOLDOWN_MS) return false

  const last = await lastSuccessfulCompanyRunAt()
  if (!last) return true
  return Date.now() - last.getTime() > MISSED_AFTER_MS
}

export function startOpportunityScheduler(): void {
  if (globalRef.__kaasebOpportunityCron) return
  if (!enabled()) return
  globalRef.__kaasebOpportunityCron = true

  cron.schedule(
    CRON_EXPRESSION,
    () => {
      // Detached on purpose: a cron tick must never hold the event loop or
      // throw into node-cron's internals. runScan() records its own failures.
      // The in-page pause switch is checked HERE so flipping it off stops the
      // very next run without a redeploy.
      void (async () => {
        if (!(await getAutoScan('opportunities'))) return
        await runScan({ trigger: 'schedule' })
      })().catch(() => {})
    },
    { timezone: TIMEZONE },
  )

  cron.schedule(
    COMPANIES_CRON_EXPRESSION,
    () => {
      void (async () => {
        if (!(await getAutoScan('companies'))) return
        await runCompanyScan({ trigger: 'schedule' })
      })().catch(() => {})
    },
    { timezone: TIMEZONE },
  )

  // Boot catch-up — the safety net for "the server was down at 03:00".
  // Sequential, not parallel: two web_search scans at once is exactly the token
  // spike we spent the afternoon designing out.
  setTimeout(() => {
    void (async () => {
      try {
        if ((await getAutoScan('opportunities')) && (await shouldCatchUp())) {
          await runScan({ trigger: 'schedule' })
        }
      } catch {
        /* never let the safety net take the server down */
      }
      try {
        if ((await getAutoScan('companies')) && (await shouldCatchUpCompanies())) {
          await runCompanyScan({ trigger: 'schedule' })
        }
      } catch {
        /* same */
      }
    })()
  }, BOOT_DELAY_MS).unref?.()

  console.log(`[الفرص] daily scan scheduled — ${CRON_EXPRESSION} (${TIMEZONE})`)
  console.log(`[شركات] daily scan scheduled — ${COMPANIES_CRON_EXPRESSION} (${TIMEZONE})`)
}
