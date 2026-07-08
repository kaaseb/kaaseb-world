import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { PreQualList } from '@/components/pre-qualifications/PreQualList'
import type { PreQualification } from '@/types'

export const dynamic = 'force-dynamic'

export default async function PreQualPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.pre_qualifications')) redirect('/dashboard')

  const { data: items } = await supabase
    .from('pre_qualifications').select('*')
    .order('created_at', { ascending: false }).limit(500)

  return (
    <PreQualList
      initialItems={(items || []) as PreQualification[]}
      canManage={hasPermission(profile, permissions, 'docs.prequal.manage')}
    />
  )
}
