// GET   /api/furn/settings  — the quotation branding + default terms
// PATCH /api/furn/settings  — update any subset of them (see lib/furn/settings-store)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getFurnSettings, saveFurnSettings } from '@/lib/furn/settings-store'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ settings: await getFurnSettings(supabase) })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('furn.settings.edit')
  if (deny) return deny

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })

  try {
    return NextResponse.json({ settings: await saveFurnSettings(body) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'تعذّر الحفظ' }, { status: 500 })
  }
}
