// GET   /api/furn/projects/[id]/flags → { flags: { [itemId]: {reason,red,status} } }
// PATCH /api/furn/projects/[id]/flags { itemId, status } → approve/reject one row
//
// The review layer for the router's "needs a human" flags. Nothing is ever
// deleted — a rejected row just leaves the quotation; the flag remembers why.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getProjectItemFlags, updateItemFlagStatus, type FlagStatus } from '@/lib/furn/item-flags'
import { getProjectItemSections } from '@/lib/furn/item-sections'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [flags, sections] = await Promise.all([getProjectItemFlags(id), getProjectItemSections(id)])
  return NextResponse.json({ flags, sections })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('furn.pricing.edit')
  if (deny) return deny

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  let body: { itemId?: unknown; status?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const status = body.status
  if (!itemId || (status !== 'approved' && status !== 'rejected' && status !== 'pending')) {
    return NextResponse.json({ error: 'itemId + status(approved|rejected|pending) required' }, { status: 400 })
  }

  const flag = await updateItemFlagStatus(id, itemId, status as FlagStatus)
  if (!flag) return NextResponse.json({ error: 'Not flagged' }, { status: 404 })
  return NextResponse.json({ flag })
}
