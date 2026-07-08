// GET  /api/tannoor/colors  → { palette, byProduct, attrs }
// POST /api/tannoor/colors  → set a product's { productId, colors[], thickness_mm, finish }
//
// Holds the product extras the DB table is missing (colours, thickness, finish)
// in S3 — see src/lib/tannoor/colors.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getColors, setProductExtras } from '@/lib/tannoor/colors'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getColors())
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { productId?: string; colors?: unknown; thickness_mm?: unknown; finish?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const colors = Array.isArray(body.colors) ? body.colors.map(c => String(c)).slice(0, 30) : []
  const thickness_mm = body.thickness_mm === '' || body.thickness_mm == null ? null
    : (Number.isFinite(Number(body.thickness_mm)) ? Number(body.thickness_mm) : null)
  const finish = typeof body.finish === 'string' ? body.finish : null

  const store = await setProductExtras(body.productId, { colors, thickness_mm, finish })
  return NextResponse.json(store)
}
