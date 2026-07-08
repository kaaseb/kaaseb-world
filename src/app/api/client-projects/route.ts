// GET  /api/client-projects   — list (with search/status/stage filters)
// POST /api/client-projects   — create

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const stage  = searchParams.get('stage')
  const q      = searchParams.get('q')?.trim()

  // Hydrate the responsible_user join so the list cell can show "Mona"
  // without a second round-trip. The relationship is the FK on
  // responsible_user_id → profiles.id.
  let query = supabase
    .from('client_projects')
    .select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (status) query = query.eq('status', status)
  if (stage)  query = query.eq('stage',  stage)
  if (q) {
    // Search across both languages so users can query in whichever they entered.
    query = query.or(
      `name_en.ilike.%${q}%,name_ar.ilike.%${q}%,company_en.ilike.%${q}%,company_ar.ilike.%${q}%,engineer_name_en.ilike.%${q}%,engineer_name_ar.ilike.%${q}%`
    )
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projects: data || [] })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  // Require at least one of {name_en, name_ar}.
  const nameEn = String(body.name_en || '').trim()
  const nameAr = String(body.name_ar || '').trim()
  if (!nameEn && !nameAr) {
    return NextResponse.json({ error: 'Project name is required (English or Arabic)' }, { status: 400 })
  }

  const rawCurrency = String(body.pricing_currency || 'SAR').toUpperCase()
  const pricingCurrency = rawCurrency === 'USD' ? 'USD' : 'SAR'

  // responsible_user_id is optional. Accept either a UUID string or null/empty
  // — anything else gets coerced to null so the FK never trips.
  const rawResp = body.responsible_user_id
  const responsibleUserId = typeof rawResp === 'string' && rawResp.length > 0 ? rawResp : null

  const { data, error } = await supabase.from('client_projects').insert({
    name_en: nameEn || null,
    name_ar: nameAr || null,
    company_en: String(body.company_en || '').trim() || null,
    company_ar: String(body.company_ar || '').trim() || null,
    engineer_name_en: String(body.engineer_name_en || '').trim() || null,
    engineer_name_ar: String(body.engineer_name_ar || '').trim() || null,
    engineer_phone: String(body.engineer_phone || '').trim() || null,
    end_date: body.end_date || null,
    pricing_currency: pricingCurrency,
    status: String(body.status || 'new'),
    stage:  String(body.stage  || 'receive_quotes'),
    keywords: String(body.keywords || '').trim() || null,
    notes:  String(body.notes  || '').trim() || null,
    files:  Array.isArray(body.files) ? body.files : [],
    responsible_user_id: responsibleUserId,
    created_by: user.id,
  }).select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(id, full_name, email, avatar_url)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'client_project',
    objectName: data.name_en || data.name_ar, objectId: data.id,
  })
  return NextResponse.json({ project: data })
}
