// GET   /api/prequal/settings → the cover/back template urls + TOC title
// PATCH /api/prequal/settings → super-admin: set cover_url / back_url / toc titles
//
// Backed by an S3 JSON object (src/lib/prequal/store).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getPreQualTemplates, setPreQualTemplates, type PreQualTemplates } from '@/lib/prequal/store'

const KEYS: (keyof PreQualTemplates)[] = ['cover_url', 'back_url', 'toc_title_ar', 'toc_title_en']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ templates: await getPreQualTemplates() })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const patch: Partial<PreQualTemplates> = {}
  for (const k of KEYS) {
    const v = body[k]
    if (k === 'cover_url' || k === 'back_url') {
      if (typeof v === 'string' || v === null) patch[k] = (v as string | null) || null
    } else if (typeof v === 'string') {
      patch[k] = v.slice(0, 120)
    }
  }

  return NextResponse.json({ templates: await setPreQualTemplates(patch) })
}
