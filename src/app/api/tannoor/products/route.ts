import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await supabase
    .from('tannoor_products')
    .select('*, furn_departments(id, name_en, name_ar)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data || [] })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!String(body.name_en || '').trim() && !String(body.name_ar || '').trim()) {
    return NextResponse.json({ error: 'Product name required' }, { status: 400 })
  }

  // Normalise a "blank or numeric" input — empty string / null / undefined
  // → null (clears the value); otherwise → a clamped non-negative number.
  function nullableNum(raw: unknown): number | null {
    if (raw === '' || raw === null || raw === undefined) return null
    const n = Number(raw)
    return Number.isFinite(n) ? Math.max(0, n) : null
  }
  // Availability is a closed enum — anything outside the allow-list becomes
  // null so the DB CHECK constraint never trips.
  const AVAIL = new Set(['high', 'medium', 'low', 'out_of_stock'])
  function nullableAvailability(raw: unknown): string | null {
    return typeof raw === 'string' && AVAIL.has(raw) ? raw : null
  }

  const { data, error } = await supabase.from('tannoor_products').insert({
    name_en:           String(body.name_en        || '').trim() || null,
    name_ar:           String(body.name_ar        || '').trim() || null,
    description_en:    String(body.description_en || '').trim() || null,
    description_ar:    String(body.description_ar || '').trim() || null,
    department_id:     body.department_id || null,
    unit:              String(body.unit || 'm'),
    // thickness_mm, finish, color_* live in the S3 extras store — those columns
    // don't exist in the table.
    size_w_mm:         nullableNum(body.size_w_mm),
    size_l_mm:         nullableNum(body.size_l_mm),
    availability:      nullableAvailability(body.availability),
    price_sar:         Math.max(0, Number(body.price_sar) || 0),
    price_usd:         Math.max(0, Number(body.price_usd) || 0),
    notes:             String(body.notes || '').trim() || null,
    created_by:        user.id,
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'add', objectType: 'tannoor_product',
    objectName: data.name_en || data.name_ar, objectId: data.id,
  })
  return NextResponse.json({ product: data })
}
