import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { getCompaniesState } from '@/lib/companies/store'
import { CompaniesClient } from '@/components/companies/CompaniesClient'

export const dynamic = 'force-dynamic'

export default async function CompaniesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.companies')) redirect('/dashboard')

  const { items, lastRun } = await getCompaniesState()

  return <CompaniesClient initialItems={items} initialLastRun={lastRun} />
}
