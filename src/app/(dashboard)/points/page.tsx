import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PointsClient } from '@/components/points/PointsClient'
import { getProfileOrFallback } from '@/lib/profile'
import type { Profile } from '@/types'

export type LedgerEntry = {
  id: string
  user_id: string | null
  user_name: string | null
  user_email: string | null
  action_type: string
  object_type: string
  object_name: string | null
  points: number
  status: string
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export type DepartmentWithMembers = {
  id: string
  name: string
  icon: string | null
  color: string | null
  department_members: {
    user_id: string
    profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points'> | null
  }[]
}

export default async function PointsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  let allProfiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points' | 'role'>[] = []
  let departments: DepartmentWithMembers[] = []
  let ledger: LedgerEntry[] = []

  try {
    const [usersRes, deptsRes, ledgerRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, avatar_url, total_points, role').order('total_points', { ascending: false }),
      supabase.from('departments').select('id, name, icon, color, department_members(user_id, profiles(id, full_name, email, avatar_url, total_points))'),
      supabase
        .from('pending_points')
        .select('id, user_id, user_name, user_email, action_type, object_type, object_name, points, status, created_at, reviewed_by, reviewed_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    allProfiles = (usersRes.data || []) as typeof allProfiles
    departments = (deptsRes.data || []) as unknown as DepartmentWithMembers[]
    ledger = (ledgerRes.data || []) as LedgerEntry[]
  } catch { /* tables may not exist yet */ }

  return (
    <PointsClient
      profile={profile}
      allProfiles={allProfiles}
      departments={departments}
      initLedger={ledger}
    />
  )
}
