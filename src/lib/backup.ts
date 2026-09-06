// Daily backup of every app-data JSON blob (manual quotes, terms, locks, delivery,
// settings…) — the S3-only design has no history: one bad write is the only copy.
//
// Cheap by construction: server-side CopyObject (no bytes through the app),
// once per calendar day (state blob), capped file count, telemetry/cache
// prefixes skipped, and backups older than RETENTION_DAYS pruned so the bucket
// never grows without bound. Triggered from the dashboard by a super-admin
// (same pattern as the dues / docs-expiry sweeps) or on demand via the route.

import { copyObject, deleteFromS3, listKeys, readJson, writeJson } from '@/lib/s3'

const PREFIX = 'app-data/'
const BACKUP_PREFIX = 'backups/'
const STATE_KEY = 'app-data/_backup-state.json'
const RETENTION_DAYS = 30
const MAX_FILES = 500
// Telemetry / caches: regenerable, sometimes numerous — not worth backing up.
const SKIP_PREFIXES = ['app-data/furn-runs/', 'app-data/boq-index/', 'app-data/index-cache/']

export interface BackupState { lastDate: string | null; lastCount: number; lastAt: string | null }
export interface BackupResult { ran: boolean; date: string; copied: number; pruned: number; skipped: number }

const dayOf = (d: Date) => d.toISOString().slice(0, 10)

export async function getBackupState(): Promise<BackupState> {
  return readJson<BackupState>(STATE_KEY, { lastDate: null, lastCount: 0, lastAt: null })
}

export async function runDailyBackup(force = false): Promise<BackupResult> {
  const today = dayOf(new Date())
  const state = await getBackupState()
  if (!force && state.lastDate === today) return { ran: false, date: today, copied: 0, pruned: 0, skipped: 0 }

  const all = (await listKeys(PREFIX)).filter((k) => k.endsWith('.json') && k !== STATE_KEY && !SKIP_PREFIXES.some((p) => k.startsWith(p)))
  const keys = all.slice(0, MAX_FILES)
  let copied = 0
  for (const k of keys) {
    try { await copyObject(k, `${BACKUP_PREFIX}${today}/${k}`); copied++ } catch { /* best effort per file */ }
  }

  // Prune day-folders past the retention window.
  const cutoff = dayOf(new Date(Date.now() - RETENTION_DAYS * 86_400_000))
  let pruned = 0
  for (const k of await listKeys(BACKUP_PREFIX)) {
    const date = k.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoff) {
      try { await deleteFromS3(k); pruned++ } catch { /* best effort */ }
    }
  }

  await writeJson(STATE_KEY, { lastDate: today, lastCount: copied, lastAt: new Date().toISOString() })
  return { ran: true, date: today, copied, pruned, skipped: all.length - keys.length }
}
