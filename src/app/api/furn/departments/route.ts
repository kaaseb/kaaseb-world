// GET  /api/furn/departments  — list all (covered + suggested)
// POST /api/furn/departments  — add a new department

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('furn_departments').select('*').order('is_default', { ascending: false }).order('name_en')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ departments: data || [] })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { name_en?: string; name_ar?: string; enabled?: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const nameEn = (body.name_en || '').trim()
  const nameAr = (body.name_ar || '').trim()
  if (!nameEn || !nameAr) return NextResponse.json({ error: 'Both names are required' }, { status: 400 })

  const { data, error } = await supabase.from('furn_departments').insert({
    name_en: nameEn,
    name_ar: nameAr,
    enabled: body.enabled ?? true,
    is_default: false,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ department: data })
}
