// One-line write-permission gate for API routes.
//
// A route already does its own CSRF + auth; this ADDS the fine-grained write
// check so a "read-only" role (page access but no write key) is blocked
// server-side, not just in the UI. Usage at the top of a mutating handler:
//
//   const deny = await denyUnlessPermitted('furn.pricing.edit')
//   if (deny) return deny
//
// It resolves auth independently (a couple of extra reads on writes only), so it
// composes with any existing route structure without refactoring it.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission, type PermissionKey } from '@/lib/permissions'

export async function denyUnlessPermitted(key: PermissionKey): Promise<NextResponse | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, key)) {
    return NextResponse.json({ error: 'ما عندك صلاحية التعديل هنا (قراءة فقط).' }, { status: 403 })
  }
  return null
}
