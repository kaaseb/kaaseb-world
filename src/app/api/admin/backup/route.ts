// POST /api/admin/backup — run today's app-data backup (super-admin only).
// Body: { force?: boolean } to re-run even if today's backup already exists.
// GET  /api/admin/backup — last backup state (super-admin only).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getBackupState, runDailyBackup } from '@/lib/backup'

export const runtime = 'nodejs'
export const maxDuration = 120

async function superAdminOnly() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') return NextResponse.json({ error: 'هذا الإجراء للسوبر أدمن فقط.' }, { status: 403 })
  return null
}

export async function GET() {
  const deny = await superAdminOnly()
  if (deny) return deny
  return NextResponse.json({ state: await getBackupState() })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const deny = await superAdminOnly()
  if (deny) return deny
  let body: { force?: unknown } = {}
  try { body = await request.json() } catch { /* empty body is fine */ }
  try {
    const result = await runDailyBackup(body.force === true)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'فشل النسخ الاحتياطي' }, { status: 500 })
  }
}
