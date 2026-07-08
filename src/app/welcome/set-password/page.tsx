import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SetPasswordClient } from './SetPasswordClient'
import { LanguageProvider } from '@/contexts/LanguageContext'
import type { Lang } from '@/lib/i18n/translations'

export default async function SetPasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('must_change_password, full_name, email, language')
    .eq('id', user.id)
    .single()

  // If the flag is already cleared, no need to be on this page.
  if (!profile?.must_change_password) redirect('/dashboard')

  const lang: Lang = profile.language === 'ar' ? 'ar' : 'en'

  return (
    <LanguageProvider initialLang={lang} userId={user.id}>
      <SetPasswordClient userName={profile.full_name || profile.email} />
    </LanguageProvider>
  )
}
