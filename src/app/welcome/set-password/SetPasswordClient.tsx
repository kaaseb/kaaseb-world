'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { KeyRound, Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  userName: string
}

const MIN_LENGTH = 10

export function SetPasswordClient({ userName }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Lightweight strength check — keeps the bar above the previous
  // shared-default scenario without locking out users with non-Latin layouts.
  const valid =
    password.length >= MIN_LENGTH &&
    password === confirm &&
    /[a-zA-Z]/.test(password) &&
    /[0-9]/.test(password)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) {
      toast.error(t('welcome_password_requirements'))
      return
    }
    setSubmitting(true)

    const { data: userData, error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError || !userData.user) {
      toast.error(pwError?.message || 'Failed')
      setSubmitting(false)
      return
    }

    // Clear the flag so subsequent logins go straight to the dashboard.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', userData.user.id)

    if (profileError) {
      toast.error(profileError.message)
      setSubmitting(false)
      return
    }

    toast.success(t('welcome_password_saved'))
    router.replace('/dashboard')
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4"
    >
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-amber-700" />
          </div>
          <CardTitle className="text-xl">{t('welcome_set_password_title')}</CardTitle>
          <CardDescription>
            {t('welcome_hi')} <span className="font-semibold">{userName}</span> — {t('welcome_set_password_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t('welcome_new_password')}</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">{t('welcome_confirm_password')}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <p className="text-xs text-gray-500">{t('welcome_password_requirements')}</p>
            <Button type="submit" disabled={!valid || submitting} className="w-full">
              {submitting
                ? <><Loader2 className="w-4 h-4 me-2 animate-spin" />{t('saving')}...</>
                : t('welcome_continue')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
