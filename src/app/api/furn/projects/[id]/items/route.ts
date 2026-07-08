// PATCH /api/furn/projects/[id]/items  — bulk update prices & details
//                                          (one round-trip for the whole table)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

interface ItemPatch {
  id: string
  description?: string
  details?: string | null
  quantity?: number
  unit?: string
  unit_price?: number | null
  notes?: string | null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { items: ItemPatch[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!Array.isArray(body.items)) return NextResponse.json({ error: 'items array required' }, { status: 400 })

  // Apply each item update. We could batch via upsert, but updating one row at
  // a time keeps RLS / per-row checks simple and the payload is small (a few
  // hundred items at most per project).
  const errors: string[] = []
  for (const it of body.items) {
    if (!it.id) continue
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof it.description === 'string') patch.description = it.description
    if (typeof it.details === 'string' || it.details === null) patch.details = it.details
    if (typeof it.quantity === 'number' && Number.isFinite(it.quantity)) patch.quantity = Math.max(0, it.quantity)
    if (typeof it.unit === 'string') patch.unit = it.unit
    if (it.unit_price === null || (typeof it.unit_price === 'number' && Number.isFinite(it.unit_price))) {
      patch.unit_price = it.unit_price === null ? null : Math.max(0, it.unit_price)
    }
    if (typeof it.notes === 'string' || it.notes === null) patch.notes = it.notes

    const { error } = await supabase.from('furn_items').update(patch).eq('id', it.id).eq('project_id', id)
    if (error) errors.push(`${it.id}: ${error.message}`)
  }

  if (errors.length > 0) return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST /api/furn/projects/[id]/items — append a manual item (admin override)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { description?: string; details?: string; quantity?: number; unit?: string; notes?: string; unit_price?: number }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const description = (body.description || '').trim()
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const { data: maxRow } = await supabase
    .from('furn_items').select('position')
    .eq('project_id', id).order('position', { ascending: false }).limit(1).maybeSingle()

  const nextPos = (maxRow?.position || 0) + 1

  const { data, error } = await supabase.from('furn_items').insert({
    project_id: id,
    position: nextPos,
    description,
    details: body.details ? body.details.trim() : null,
    quantity: Math.max(0, Number(body.quantity) || 0),
    unit: (body.unit || 'm').trim(),
    notes: body.notes || null,
    unit_price: body.unit_price ?? null,
    ai_confidence: 1, // hand-entered = 100%
  }).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}
