// POST /api/opportunities/[id]/contacts — the "جيب التواصل" button.
//
// Runs the dedicated contact hunt for this row's `owner` and stores whatever it
// finds. Unlike the daily scan this AWAITS the result: it's one small search
// (~15s) fired by a human who is sitting there watching the card, so returning
// the answer directly beats making the page poll for it.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getOpportunity, setContacts } from '@/lib/opportunities/store'
import { huntContacts } from '@/lib/opportunities/contacts'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const opp = await getOpportunity(id)
  if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!opp.owner) {
    return NextResponse.json({ error: 'ما فيه جهة محددة للبحث عنها' }, { status: 400 })
  }

  try {
    const contacts = await huntContacts({
      owner: opp.owner,
      project: opp.title,
      city: opp.city,
    })
    // Stamped even when empty — that's the difference between "we looked and
    // they publish nothing" and "nobody has looked yet".
    const item = await setContacts(id, contacts)
    return NextResponse.json({ item, found: contacts.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'فشل البحث عن جهات التواصل' },
      { status: 500 },
    )
  }
}
