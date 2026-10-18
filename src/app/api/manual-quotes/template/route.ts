// GET /api/manual-quotes/template?lang=ar|en — the blank KAASEB quotation template.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { buildQuoteTemplate } from '@/lib/manual-quotes/template-xlsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const lang = new URL(request.url).searchParams.get('lang') === 'en' ? 'en' : 'ar'
  const buf = await buildQuoteTemplate(null, { lang })
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Kaaseb_Quote_Template.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
