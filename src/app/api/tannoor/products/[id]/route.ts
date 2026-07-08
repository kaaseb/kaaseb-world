import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { serverAudit } from '@/lib/audit-server'

// thickness_mm, finish, color_* are NOT columns on this table — they live in
// the S3 extras store (src/lib/tannoor/colors). Only real columns are allowed.
const ALLOWED = new Set([
  'name_en', 'name_ar', 'description_en', 'description_ar',
  'department_id', 'unit',
  'size_w_mm', 'size_l_mm',
  'availability',
  'price_sar', 'price_usd', 'notes',
])
const AVAILABILITY_VALUES = new Set(['high', 'medium', 'low', 'out_of_stock'])
const NUMERIC_NULLABLE = new Set(['size_w_mm', 'size_l_mm'])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) continue
    if ((k === 'price_sar' || k === 'price_usd') && typeof v === 'number') {
      patch[k] = Math.max(0, v)
    } else if (NUMERIC_NULLABLE.has(k)) {
      // Treat empty / null as "clear value" so the user can blank out
      // thickness / sizes from the form.
      if (v === null || v === '' || v === undefined) {
        patch[k] = null
      } else {
        const n = Number(v)
        patch[k] = Number.isFinite(n) ? Math.max(0, n) : null
      }
    } else if (k === 'availability') {
      // Closed enum — anything outside the allow-list clears the field
      // (the DB CHECK would otherwise reject the row).
      patch[k] = typeof v === 'string' && AVAILABILITY_VALUES.has(v) ? v : null
    } else {
      patch[k] = v
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  const { data, error } = await supabase
    .from('tannoor_products').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'tannoor_product',
    objectName: data.name_en || data.name_ar, objectId: data.id,
  })
  return NextResponse.json({ product: data })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('tannoor_products').select('name_en, name_ar').eq('id', id).maybeSingle()

  const { error } = await supabase.from('tannoor_products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await serverAudit({
    user, supabase, action: 'delete', objectType: 'tannoor_product',
    objectName: existing?.name_en || existing?.name_ar || null, objectId: id,
  })
  return NextResponse.json({ ok: true })
}
