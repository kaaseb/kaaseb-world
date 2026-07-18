'use client'

// The PIN gate shown when the inbox is locked. Enter the shared secret → the
// server sets an httpOnly unlock cookie → we refresh so the page re-renders the
// real inbox. The PIN itself never touches client state beyond this input.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useLanguage } from '@/contexts/LanguageContext'

export function InboxLock() {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/inbox/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || t('inbox_pin_wrong'))
        setPin('')
        return
      }
      toast.success(t('inbox_unlocked'))
      router.refresh()
    } catch {
      setError(t('inbox_pin_wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 min-h-[70vh] flex items-center justify-center">
      <Card className="w-full max-w-sm border shadow-sm">
        <CardContent className="p-6 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('inbox_locked_title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('inbox_locked_desc')}</p>
          </div>

          <form onSubmit={submit} className="w-full flex flex-col gap-3 mt-2">
            <div className="relative">
              <KeyRound className={`w-4 h-4 text-muted-foreground absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-3' : 'left-3'}`} />
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t('inbox_pin_placeholder')}
                className={`w-full h-11 rounded-lg border bg-white text-center text-lg tracking-widest outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 ${error ? 'border-red-300' : 'border-gray-200'} ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !pin.trim()} className="gap-2 h-11">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {t('inbox_unlock_btn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
