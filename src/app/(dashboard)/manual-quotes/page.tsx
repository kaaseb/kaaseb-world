import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { listManualQuotes } from '@/lib/manual-quotes/store'
import { ManualQuotesClient } from '@/components/manual-quotes/ManualQuotesClient'

export const dynamic = 'force-dynamic'

export default async function ManualQuotesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) redirect('/dashboard')

  const quotes = await listManualQuotes()
  return <ManualQuotesClient initialQuotes={quotes} />
}
