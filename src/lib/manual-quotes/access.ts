// Who may read/edit manual quotes (page.furn), and how they are named in the history.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'

export type QuoteActor = { id: string; name: string }

export async function quoteAccess(): Promise<{ error: NextResponse } | { actor: QuoteActor }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const name = profile.full_name && profile.full_name !== 'Setup Required' ? profile.full_name : (user.email || '')
  return { actor: { id: user.id, name } }
}
