// Shared profile helper used by every server component in the dashboard.
//
// Returns a non-null Profile no matter what — if the row is missing (DB not
// seeded yet, RLS hiccup, race condition right after signup), we synthesize
// a stub from the auth.users record. The page can then render and let the
// user fix things from the UI instead of crashing with `Cannot read
// properties of null (reading 'role')` or bouncing them through a
// /login → /dashboard redirect loop.

import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Profile, UserRole } from '@/types'

export async function getProfileOrFallback(
  supabase: SupabaseClient,
  user: Pick<User, 'id' | 'email'>
): Promise<Profile> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    if (data) return data as Profile
  } catch {
    // Table missing or transient error — fall through to the stub below.
  }

  const ADMIN_ALLOWLIST = ['elzubair.mail@gmail.com', 'it@ghassl.com']
  const role: UserRole = user.email && ADMIN_ALLOWLIST.includes(user.email.toLowerCase())
    ? 'super_admin'
    : 'employee'

  const now = new Date().toISOString()
  return {
    id: user.id,
    email: user.email || '',
    full_name: 'Setup Required',
    avatar_url: null,
    role,
    bio: null,
    title: null,
    language: 'ar',
    total_points: 0,
    lock_password_hash: null,
    lock_enabled: false,
    off_days: [],
    custom_role_id: null,
    is_department_manager: false,
    scope: 'both',
    must_change_password: false,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  }
}

// Resolves the effective permissions list for the profile, falling back to
// the role's default set when no custom_role is attached. Centralized so
// every page handles missing custom_roles tables / rows the same way.
export async function getEffectivePermissions(
  supabase: SupabaseClient,
  profile: Profile
): Promise<string[]> {
  // Importing DEFAULT_PERMISSIONS at the top would create a cycle for some
  // pages — we resolve it dynamically.
  const { DEFAULT_PERMISSIONS } = await import('@/lib/permissions')
  let permissions: string[] = DEFAULT_PERMISSIONS[
    profile.role as 'super_admin' | 'project_manager' | 'employee'
  ] ?? []

  if (profile.custom_role_id) {
    try {
      const { data: cr } = await supabase
        .from('custom_roles')
        .select('permissions')
        .eq('id', profile.custom_role_id)
        .maybeSingle()
      if (cr?.permissions) permissions = cr.permissions as string[]
    } catch { /* table missing — keep default */ }
  }
  return permissions
}
