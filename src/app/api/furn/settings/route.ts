// GET   /api/furn/settings  — fetch the singleton settings row
// PATCH /api/furn/settings  — update branding + defaults

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

const ALLOWED = new Set([
  'header_image_url', 'signature_image_url', 'seal_image_url',
  'manager_name', 'company_phone', 'company_email',
  'commercial_register', 'tax_number', 'footer_address',
  'default_payment_terms', 'default_delivery_terms',
  'default_offer_duration', 'default_special_conditions',
  'next_quotation_number',
])

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('furn_settings').select('*').eq('id', 1).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED.has(k)) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No allowed fields' }, { status: 400 })
  patch.updated_at = new Date().toISOString()
  patch.updated_by = user.id

  const { data, error } = await supabase
    .from('furn_settings').update(patch).eq('id', 1).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
