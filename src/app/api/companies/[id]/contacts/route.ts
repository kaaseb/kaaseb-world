// POST /api/companies/[id]/contacts — the "جيب التواصل" button.
//
// Reuses the opportunities contact hunt verbatim: "find the published business
// contacts for THIS named Saudi entity" is the same job whether the name came
// from a news article or from the account list.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getCompany, setCompanyContacts } from '@/lib/companies/store'
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
  if (!hasPermission(profile, permissions, 'page.companies')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const company = await getCompany(id)
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const contacts = await huntContacts({ owner: company.name, city: company.city })
    const item = await setCompanyContacts(id, contacts)
    return NextResponse.json({ item, found: contacts.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'فشل البحث عن جهات التواصل' },
      { status: 500 },
    )
  }
}
