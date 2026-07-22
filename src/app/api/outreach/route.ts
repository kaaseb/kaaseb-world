// GET /api/outreach — the outreach template + attached company profile
// PUT /api/outreach — save it (SUPER ADMIN only: this text is what customers
//                     receive under the company's name).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getOutreachTemplate, saveOutreachTemplate } from '@/lib/outreach/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ template: await getOutreachTemplate() })
}

export async function PUT(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'تعديل القالب للسوبر أدمن فقط.' }, { status: 403 })
  }

  let body: { subject?: unknown; body?: unknown; profileUrl?: unknown; profileName?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const template = await saveOutreachTemplate({
    subject: typeof body.subject === 'string' ? body.subject : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
    profileUrl: typeof body.profileUrl === 'string' || body.profileUrl === null ? (body.profileUrl as string | null) : undefined,
    profileName: typeof body.profileName === 'string' || body.profileName === null ? (body.profileName as string | null) : undefined,
  })
  return NextResponse.json({ template })
}
