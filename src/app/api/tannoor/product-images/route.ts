// GET  /api/tannoor/product-images           → { images: { [productId]: url } }
// POST /api/tannoor/product-images           → set { productId, url } (url null clears)
//
// Local-file backed (src/lib/tannoor/product-images) so product photos work
// with no Supabase/SQL access.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProductImages, setProductImage } from '@/lib/tannoor/product-images'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ images: await getProductImages() })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { productId?: string; url?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const images = await setProductImage(body.productId, body.url ? String(body.url) : null)
  return NextResponse.json({ images })
}
