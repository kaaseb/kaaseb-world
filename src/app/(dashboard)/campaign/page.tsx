// /campaign — «حملة المشاريع» (temporary). Super admin only.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfileOrFallback } from '@/lib/profile'
import { CampaignClient } from '@/components/campaign/CampaignClient'

export default async function CampaignPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') redirect('/dashboard')
  return <CampaignClient />
}
