import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AuditClient } from '@/components/audit/AuditClient'
import { PageLockWrapper } from '@/components/lock-screen/PageLockWrapper'
import { getProfileOrFallback } from '@/lib/profile'

export default async function AuditPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') redirect('/dashboard')

  return (
    <PageLockWrapper profile={profile} pageKey="audit">
      <AuditClient />
    </PageLockWrapper>
  )
}
