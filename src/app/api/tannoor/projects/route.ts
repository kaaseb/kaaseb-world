import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stage  = searchParams.get('stage')
  const status = searchParams.get('status')
  const q      = searchParams.get('q')?.trim()

  let query = supabase.from('tannoor_projects').select('*').order('created_at', { ascending: false }).limit(500)
  if (stage)  query = query.eq('stage',  stage)
  if (status) query = query.eq('status', status)
  if (q) {
    query = query.or(
      `project_name_en.ilike.%${q}%,project_name_ar.ilike.%${q}%,company_en.ilike.%${q}%,company_ar.ilike.%${q}%`
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

  const nameEn = String(body.project_name_en || '').trim()
  const nameAr = String(body.project_name_ar || '').trim()
  if (!nameEn && !nameAr) return NextResponse.json({ error: 'Project name required' }, { status: 400 })
  if (!body.boq_url)       return NextResponse.json({ error: 'BOQ file required' }, { status: 400 })

  const { data, error } = await supabase.from('tannoor_projects').insert({
    project_name_en:    nameEn || null,
    project_name_ar:    nameAr || null,
    company_en:         String(body.company_en || '').trim() || null,
    company_ar:         String(body.company_ar || '').trim() || null,
    engineer_name_en:   String(body.engineer_name_en || '').trim() || null,
    engineer_name_ar:   String(body.engineer_name_ar || '').trim() || null,
    engineer_phone:     String(body.engineer_phone || '').trim() || null,
    commercial_register: String(body.commercial_register || '').trim() || null,
    tax_number:         String(body.tax_number || '').trim() || null,
    payment_terms:      String(body.payment_terms || '').trim() || null,
    delivery_terms:     String(body.delivery_terms || '').trim() || null,
    offer_duration:     String(body.offer_duration || '').trim() || null,
    special_conditions: String(body.special_conditions || '').trim() || null,
    boq_url:            String(body.boq_url),
    boq_filename:       String(body.boq_filename || 'BOQ'),
    spec_files:         Array.isArray(body.spec_files) ? body.spec_files.slice(0, 10) : [],
    drawing_files:      Array.isArray(body.drawing_files) ? body.drawing_files.slice(0, 10) : [],
    stage:              'processing',
    status:             'pending',
    created_by:         user.id,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'tannoor_project',
    objectName: data.project_name_en || data.project_name_ar, objectId: data.id,
  })
  return NextResponse.json({ project: data })
}
