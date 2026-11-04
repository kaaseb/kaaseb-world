// The campaign sends email in the company's name — super admin only.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback } from '@/lib/profile'

export async function campaignAccess(): Promise<{ error: NextResponse } | { name: string; email: string | null; userId: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') return { error: NextResponse.json({ error: 'للمدير العام فقط' }, { status: 403 }) }
  const name = profile.full_name && profile.full_name !== 'Setup Required' ? profile.full_name : (user.email || '')
  return { name, email: profile.email || user.email || null, userId: user.id }
}
