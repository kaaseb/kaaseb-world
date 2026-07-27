// GET /api/furn/quote-message → the bilingual quotation cover message
// PUT /api/furn/quote-message  → save it (super-admin — it's sent under the
//                                company name)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getQuoteMessage, setQuoteMessage } from '@/lib/furn/quote-message'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ message: await getQuoteMessage() })
}

export async function PUT(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'تعديل رسالة العرض للسوبر أدمن فقط.' }, { status: 403 })
  }
  let body: { ar?: unknown; en?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const message = await setQuoteMessage({
    ar: typeof body.ar === 'string' ? body.ar : undefined,
    en: typeof body.en === 'string' ? body.en : undefined,
  })
  return NextResponse.json({ message })
}
