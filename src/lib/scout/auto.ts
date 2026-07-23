// Runtime on/off switch for the daily scouts (الفرص / شركات).
//
// The OPPORTUNITIES_CRON env flag decides whether the schedule EXISTS at all;
// this decides, per feature, whether an existing schedule actually RUNS today.
// It lives in S3 so the owner can flip it from the page without a redeploy — the
// scheduled tick reads it right before scanning, so turning it off stops the
// next 3 AM run (and the boot catch-up) without touching a running scan.
//
// Default is ON: an unset store means "auto-scan as before", so nothing changes
// for anyone until they deliberately pause it.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/scout-auto.json'

export type ScoutFeature = 'opportunities' | 'companies'

interface AutoState {
  opportunities: boolean
  companies: boolean
}

async function read(): Promise<AutoState> {
  const s = await readJson<Partial<AutoState> | null>(KEY, null)
  return {
    opportunities: s?.opportunities !== false, // default true
    companies: s?.companies !== false,
  }
}

export async function getAutoScan(feature: ScoutFeature): Promise<boolean> {
  return (await read())[feature]
}

export async function getAllAutoScan(): Promise<AutoState> {
  return read()
}

export async function setAutoScan(feature: ScoutFeature, on: boolean): Promise<AutoState> {
  const cur = await read()
  const next = { ...cur, [feature]: on }
  await writeJson(KEY, next)
  return next
}
