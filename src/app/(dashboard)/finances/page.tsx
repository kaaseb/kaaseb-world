import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { FinancesClient } from '@/components/finances/FinancesClient'
import { PageLockWrapper } from '@/components/lock-screen/PageLockWrapper'
import { getProfileOrFallback } from '@/lib/profile'

export default async function FinancesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)

  if (profile.role !== 'super_admin') redirect('/dashboard')

  const admin = createAdminClient()

  const [
    { data: dues },
    { data: income },
    { data: goals },
    { data: goalSteps },
    { data: opportunities },
  ] = await Promise.all([
    admin.from('finance_dues').select('*').order('created_at', { ascending: false }),
    admin.from('finance_income').select('*').order('created_at', { ascending: false }),
    admin.from('finance_goals').select('*').order('created_at', { ascending: false }),
    admin.from('finance_goal_steps').select('*').order('position'),
    admin.from('finance_opportunities').select('*').order('created_at', { ascending: false }),
  ])

  const goalsWithSteps = (goals ?? []).map(g => ({
    ...g,
    steps: (goalSteps ?? []).filter(s => s.goal_id === g.id),
  }))

  return (
    <PageLockWrapper profile={profile} pageKey="finances">
      <FinancesClient
        initialDues={dues ?? []}
        initialIncome={income ?? []}
        initialGoals={goalsWithSteps}
        initialOpportunities={opportunities ?? []}
        userId={user.id}
      />
    </PageLockWrapper>
  )
}
