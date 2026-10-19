// /ai — كاسب AI full screen. The same assistant as the floating button.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getProfileOrFallback } from '@/lib/profile'
import { firstName } from '@/lib/kaaseb-ai/engine'
import { KaasebAiChat } from '@/components/kaaseb-ai/KaasebAiChat'

export default async function AiPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const profile = await getProfileOrFallback(supabase, user)

  return (
    <div className="h-[calc(100dvh-3.5rem)] md:h-[100dvh]">
      <KaasebAiChat mode="page" firstName={firstName(profile, user.email)} />
    </div>
  )
}
