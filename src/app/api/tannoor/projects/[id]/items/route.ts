// PATCH /api/tannoor/projects/[id]/items — bulk-save edited prices/quantities.
//
// Tannoor projects are quoted in a single currency; the team edits each line's
// unit_price (seeded from the catalog) and we persist it here so the quote and
// PDF use the edited number, not the raw catalog price.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'

interface ItemPatch {
  id: string
  unit_price?: number | null
  quantity?: number
  currency?: 'SAR' | 'USD'
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

  const errors: string[] = []
  for (const it of body.items) {
    if (!it.id) continue
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (it.unit_price === null || (typeof it.unit_price === 'number' && Number.isFinite(it.unit_price))) {
      patch.unit_price = it.unit_price === null ? null : Math.max(0, it.unit_price)
    }
    if (typeof it.quantity === 'number' && Number.isFinite(it.quantity)) patch.quantity = Math.max(0, it.quantity)
    if (it.currency === 'SAR' || it.currency === 'USD') patch.currency = it.currency

    const { error } = await supabase.from('tannoor_items').update(patch).eq('id', it.id).eq('project_id', id)
    if (error) errors.push(`${it.id}: ${error.message}`)
  }

  if (errors.length > 0) return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  return NextResponse.json({ ok: true })
}
