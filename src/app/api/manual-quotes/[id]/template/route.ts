// GET /api/manual-quotes/[id]/template — this quote as a filled KAASEB template,
// to continue working on it in Excel and upload it back.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getManualQuote } from '@/lib/manual-quotes/store'
import { buildQuoteTemplate } from '@/lib/manual-quotes/template-xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const quote = await getManualQuote(id)
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // ?lang=ar|en → the sheet in that language (it is what the quote becomes if re-uploaded).
  const l = new URL(request.url).searchParams.get('lang')
  const buf = await buildQuoteTemplate(l === 'ar' || l === 'en' ? { ...quote, language: l } : quote)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Kaaseb_${quote.number}${l === 'ar' || l === 'en' ? `-${l}` : ''}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
