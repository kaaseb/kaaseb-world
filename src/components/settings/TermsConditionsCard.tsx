'use client'

// Settings → the GLOBAL Terms & Conditions for quotations (bilingual bullet
// lines, one per line) + a default "include in quotations" switch. Super-admin.
// Each quote can still override this from its own screen.

import { useEffect, useState } from 'react'
import { Loader2, ScrollText, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function TermsConditionsCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ar, setAr] = useState('')
  const [en, setEn] = useState('')
  const [defaultEnabled, setDefaultEnabled] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/quote-terms')
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.terms) return
        setAr((j.terms.ar || []).join('\n'))
        setEn((j.terms.en || []).join('\n'))
        setDefaultEnabled(!!j.terms.defaultEnabled)
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/quote-terms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: { ar: ar.split('\n'), en: en.split('\n'), defaultEnabled } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success('تم حفظ الشروط والأحكام ✓')
    } catch { toast.error('فشل الحفظ') } finally { setSaving(false) }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-indigo-600" />
          الشروط والأحكام (للعروض السعرية)
        </CardTitle>
        <CardDescription>
          تُضبط مرة واحدة — نقطة لكل سطر، عربي وإنجليزي. يقدر كل عرض يعدّلها أو يوقف ظهورها بشكل منفصل.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={defaultEnabled} onChange={(e) => setDefaultEnabled(e.target.checked)} className="accent-indigo-600" />
              إدراجها افتراضياً في كل العروض السعرية
            </label>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-700">النص العربي (نقطة لكل سطر)</span>
                <textarea dir="rtl" rows={8} value={ar} onChange={(e) => setAr(e.target.value)}
                  className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-indigo-400 resize-y" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-700">English (one bullet per line)</span>
                <textarea dir="ltr" rows={8} value={en} onChange={(e) => setEn(e.target.value)}
                  className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-indigo-400 resize-y" />
              </label>
            </div>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
