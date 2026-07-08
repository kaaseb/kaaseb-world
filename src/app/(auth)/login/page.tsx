'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import { t as translate, type Lang } from '@/lib/i18n/translations'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [lang, setLangState] = useState<Lang>('en')
  const router = useRouter()
  const supabase = createClient()

  const isRtl = lang === 'ar'
  const t = (key: Parameters<typeof translate>[0]) => translate(key, lang)

  useEffect(() => {
    const saved = localStorage.getItem('login_lang') as Lang | null
    if (saved === 'ar' || saved === 'en') setLangState(saved)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  }, [lang, isRtl])

  function cycleLang(next: Lang) {
    setLangState(next)
    localStorage.setItem('login_lang', next)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Language toggle */}
      <div className="fixed top-4 end-4 flex items-center gap-1 bg-white/10 rounded-lg p-1">
        {(['en', 'ar'] as const).map(code => (
          <button
            key={code}
            onClick={() => cycleLang(code)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              lang === code ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            {code === 'en' ? 'EN' : 'عربي'}
          </button>
        ))}
      </div>

      <div className="w-full max-w-md px-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-72 h-32 flex items-center justify-center mb-2">
            <Image src="/kaaseb-logo.png" alt="Kaaseb" width={400} height={140} className="w-full h-full object-contain" priority />
          </div>
          <p className="text-slate-400 text-sm mt-1">{t('login_tagline')}</p>
        </div>

        <Card className="bg-white/5 backdrop-blur border-white/10 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-xl">{t('login_welcome')}</CardTitle>
            <CardDescription className="text-slate-400">
              {t('login_subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">{t('email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus:border-white/40"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-white/10 border-white/20 text-white placeholder:text-slate-500 focus:border-white/40"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-white text-slate-900 hover:bg-slate-100 font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />
                    {t('login_signing_in')}
                  </>
                ) : (
                  t('login_sign_in')
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
