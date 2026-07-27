import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { getManualQuote } from '@/lib/manual-quotes/store'
import { ManualQuoteEditor } from '@/components/manual-quotes/ManualQuoteEditor'

export const dynamic = 'force-dynamic'

export default async function ManualQuoteEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) redirect('/dashboard')

  const quote = await getManualQuote(id)
  if (!quote) notFound()

  return <ManualQuoteEditor initial={quote} />
}
