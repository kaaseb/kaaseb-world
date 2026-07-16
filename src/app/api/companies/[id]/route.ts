// PATCH  /api/companies/[id] — team sets the workflow status / notes
// DELETE /api/companies/[id] — drop a company from the list

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { updateCompany, deleteCompany } from '@/lib/companies/store'
import { isValidCompanyStatus, type CompanyStatus } from '@/lib/companies/types'

export const runtime = 'nodejs'

async function guard(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return { error: csrfError }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.companies')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { error: null }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params

  let body: { status?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  const patch: { status?: CompanyStatus; notes?: string } = {}
  if (body.status !== undefined) {
    if (!isValidCompanyStatus(body.status)) {
      return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 })
    }
    patch.status = body.status
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'notes (string) required' }, { status: 400 })
    }
    patch.notes = body.notes.slice(0, 2000)
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'لا يوجد شي للتحديث' }, { status: 400 })
  }

  const item = await updateCompany(id, patch)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await guard(request)
  if (error) return error
  const { id } = await params

  const ok = await deleteCompany(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
