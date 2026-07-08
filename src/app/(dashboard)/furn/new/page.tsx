import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { FurnNewForm } from '@/components/furn/FurnNewForm'

export const dynamic = 'force-dynamic'

export default async function FurnNewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'furn.projects.create')) {
    redirect('/furn')
  }

  return <FurnNewForm />
}
