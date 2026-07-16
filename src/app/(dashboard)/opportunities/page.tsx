import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { getState } from '@/lib/opportunities/store'
import { OpportunitiesClient } from '@/components/opportunities/OpportunitiesClient'

export const dynamic = 'force-dynamic'

export default async function OpportunitiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) redirect('/dashboard')

  // Read straight from the S3 store — no DB table involved anywhere here.
  const { items, lastRun } = await getState()

  return <OpportunitiesClient initialItems={items} initialLastRun={lastRun} />
}
