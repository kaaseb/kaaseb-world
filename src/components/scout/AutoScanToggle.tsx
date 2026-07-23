'use client'

// Pause / resume the daily auto-scan from the page itself. The manual "scan now"
// button is unaffected — this only governs the 3 AM cron run. Reflects the live
// state (loaded on mount) and flips it with one click.

import { useEffect, useState } from 'react'
import { Loader2, Play, Pause } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/LanguageContext'

export function AutoScanToggle({ feature }: { feature: 'opportunities' | 'companies' }) {
  const { lang } = useLanguage()
  const ar = lang === 'ar'
  const base = `/api/${feature}/auto`

  const [on, setOn] = useState<boolean | null>(null) // null = still loading
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const run = setTimeout(() => {
      fetch(base)
        .then((r) => r.json())
        .then((j) => { if (alive && typeof j.on === 'boolean') setOn(j.on) })
        .catch(() => {})
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [base])

  async function toggle() {
    if (on === null || busy) return
    const next = !on
    setBusy(true)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      setOn(next)
      toast.success(next
        ? (ar ? 'تم تشغيل السحب التلقائي اليومي ✓' : 'Daily auto-scan resumed ✓')
        : (ar ? 'تم إيقاف السحب التلقائي — التحديث اليدوي يظل شغّالاً' : 'Auto-scan paused — manual scan still works'))
    } catch {
      toast.error('Failed')
    } finally {
      setBusy(false)
    }
  }

  if (on === null) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      onClick={toggle}
      disabled={busy}
      title={ar ? 'يتحكم بالسحب التلقائي اليومي فقط (٣ فجراً) — التحديث اليدوي دائماً متاح' : 'Controls the daily auto-scan only; manual scan always works'}
      className={`gap-2 ${on ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      {on
        ? (ar ? 'التلقائي: مفعّل' : 'Auto: on')
        : (ar ? 'التلقائي: موقوف' : 'Auto: off')}
    </Button>
  )
}
