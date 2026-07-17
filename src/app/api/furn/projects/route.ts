// GET  /api/furn/projects   — list projects (filtered)
// POST /api/furn/projects   — create a project (form-data with files OR JSON)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stage = searchParams.get('stage')
  const status = searchParams.get('status')
  const q = searchParams.get('q')?.trim()

  let query = supabase
    .from('furn_projects')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (stage) query = query.eq('stage', stage)
  if (status) query = query.eq('status', status)
  // Search across project / company / engineer / engineer phone. Same
  // ilike pattern works for Arabic and English since Postgres treats
  // characters case-insensitively for `ilike` with a UTF-8 collation.
  if (q) query = query.or(
    `project_name.ilike.%${q}%,company_name.ilike.%${q}%,engineer_name.ilike.%${q}%,engineer_phone.ilike.%${q}%`
  )

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ projects: data || [] })
}

// Per-bucket storage cap. Deliberately generous: a real Saudi BOQ package ships
// 200+ files and the owner has said cost is not the constraint ("خليه يرفع 200
// PDF ما يهم"). What bounds the AI bill is MAX_FILES in lib/furn/boq.ts, not
// this — so store everything the team sends and let the engine choose what to
// read. Silently discarding a customer drawing is the expensive failure.
const BUCKET_CAP = 250

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    project_name?: string
    company_name?: string
    engineer_name?: string
    engineer_phone?: string
    commercial_register?: string
    tax_number?: string
    payment_terms?: string
    delivery_terms?: string
    offer_duration?: string
    special_conditions?: string
    payment_terms_en?: string
    payment_terms_ar?: string
    delivery_terms_en?: string
    delivery_terms_ar?: string
    offer_duration_en?: string
    offer_duration_ar?: string
    special_conditions_en?: string
    special_conditions_ar?: string
    boq_url?: string
    boq_filename?: string
    spec_files?: { url: string; name: string }[]
    drawing_files?: { url: string; name: string }[]
    other_files?: { url: string; name: string }[]
    source_client_project_id?: string | null
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  // Only the BOQ is mandatory now — every other identifier (name, company,
  // engineer, phone) is expected to come from the imported client project,
  // and the form accepts placeholders so an unattached new project can
  // still be saved.
  if (!body.boq_url) {
    return NextResponse.json({ error: 'BOQ file is required' }, { status: 400 })
  }
  const projectName = (body.project_name || '').trim() || 'Untitled project'
  const companyName = (body.company_name || '').trim() || '—'

  const insert = {
    project_name: projectName,
    company_name: companyName,
    engineer_name: body.engineer_name?.trim() || null,
    engineer_phone: body.engineer_phone?.trim() || null,
    commercial_register: body.commercial_register?.trim() || null,
    tax_number: body.tax_number?.trim() || null,
    payment_terms: body.payment_terms?.trim() || null,
    delivery_terms: body.delivery_terms?.trim() || null,
    offer_duration: body.offer_duration?.trim() || null,
    special_conditions: body.special_conditions?.trim() || null,
    payment_terms_en: body.payment_terms_en?.trim() || null,
    payment_terms_ar: body.payment_terms_ar?.trim() || null,
    delivery_terms_en: body.delivery_terms_en?.trim() || null,
    delivery_terms_ar: body.delivery_terms_ar?.trim() || null,
    offer_duration_en: body.offer_duration_en?.trim() || null,
    offer_duration_ar: body.offer_duration_ar?.trim() || null,
    special_conditions_en: body.special_conditions_en?.trim() || null,
    special_conditions_ar: body.special_conditions_ar?.trim() || null,
    boq_url: body.boq_url,
    boq_filename: body.boq_filename || 'BOQ',
    // Raised from 20. AGENTS.md promises "a real project can ship 200+
    // attachments", and the team confirms it: a job can genuinely arrive as 200
    // PDFs. The old cap silently threw away 140 of them — no error, no warning,
    // just a success toast and a project holding 20 of the user's 80 drawings.
    // The AI-side ceiling (MAX_FILES in lib/furn/boq.ts) is what bounds cost per
    // run; storing the files is cheap and losing the customer's drawings is not.
    spec_files: Array.isArray(body.spec_files) ? body.spec_files.slice(0, BUCKET_CAP) : [],
    drawing_files: Array.isArray(body.drawing_files) ? body.drawing_files.slice(0, BUCKET_CAP) : [],
    other_files: Array.isArray(body.other_files) ? body.other_files.slice(0, BUCKET_CAP) : [],
    source_client_project_id: body.source_client_project_id || null,
    stage: 'processing' as const,
    status: 'pending' as const,
    created_by: user.id,
  }

  const { data, error } = await supabase
    .from('furn_projects')
    .insert(insert)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: data })
}
