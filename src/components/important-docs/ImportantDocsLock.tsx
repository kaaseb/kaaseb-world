'use client'

// The PIN gate shown when the important-docs page is locked. Enter the shared
// secret → the server sets an httpOnly unlock cookie → we refresh so the page
// re-renders the real list. The PIN never touches client state beyond this input.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useLanguage } from '@/contexts/LanguageContext'

export function ImportantDocsLock() {
  const { isRtl } = useLanguage()
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tx = (ar: string, en: string) => (isRtl ? ar : en)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/important-documents/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || tx('رقم سري خاطئ', 'Wrong PIN'))
        setPin('')
        return
      }
      toast.success(tx('تم فتح القفل ✓', 'Unlocked ✓'))
      router.refresh()
    } catch {
      setError(tx('رقم سري خاطئ', 'Wrong PIN'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 min-h-[70vh] flex items-center justify-center">
      <Card className="w-full max-w-sm border shadow-sm">
        <CardContent className="p-6 flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-rose-600 flex items-center justify-center shadow-md">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{tx('الأوراق المهمة مقفلة', 'Important documents are locked')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{tx('أدخل الرقم السري للوصول إلى المستندات.', 'Enter the PIN to view the documents.')}</p>
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
                placeholder={tx('الرقم السري', 'PIN')}
                className={`w-full h-11 rounded-lg border bg-white text-center text-lg tracking-widest outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 ${error ? 'border-red-300' : 'border-gray-200'} ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !pin.trim()} className="gap-2 h-11">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {tx('فتح', 'Unlock')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
