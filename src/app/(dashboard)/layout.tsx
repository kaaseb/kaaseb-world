import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/dashboard/DashboardShell'
import { Suspense } from 'react'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'

// Minimal profile for when DB isn't set up yet
const FALLBACK_PROFILE = {
  id: '',
  email: '',
  full_name: 'Setup Required',
  avatar_url: null,
  role: 'employee' as const,
  bio: null,
  language: 'en',
  total_points: 0,
  lock_password_hash: null,
  lock_enabled: false,
  off_days: [],
  custom_role_id: null,
  is_department_manager: false,
  scope: 'both' as const,
  must_change_password: false,
  last_seen_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Try to get profile — gracefully handle if table doesn't exist
  let profile = null
  try {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    profile = data
  } catch {
    // Table might not exist yet
  }

  // Use fallback if profile is null (DB not set up)
  const safeProfile = profile ?? { ...FALLBACK_PROFILE, id: user.id, email: user.email || '' }

  // Force invitees with a server-issued password to set their own before they
  // can use any dashboard page. Skipping the redirect when the column is
  // missing keeps the app working before the migration is applied.
  if (safeProfile.must_change_password === true) {
    redirect('/welcome/set-password')
  }

  // Compute effective permissions: custom role's permissions OR default for built-in role
  let permissions: string[] = DEFAULT_PERMISSIONS[safeProfile.role as 'super_admin' | 'project_manager' | 'employee'] ?? []
  if (safeProfile.custom_role_id) {
    try {
      const { data: customRole } = await supabase
        .from('custom_roles')
        .select('permissions')
        .eq('id', safeProfile.custom_role_id)
        .single()
      if (customRole?.permissions) permissions = customRole.permissions as string[]
    } catch { /* custom_roles table may not exist yet */ }
  }

  return (
    <Suspense>
      <DashboardShell profile={safeProfile} permissions={permissions}>{children}</DashboardShell>
    </Suspense>
  )
}
