'use client'

// Super-admin panel: the USD ↔ SAR exchange rate used when a Tannoor project is
// priced in USD. 'manual' keeps the legacy per-product price_usd; a rate derives
// USD from the SAR price so the second column stops needing maintenance.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { DollarSign, Loader2, Save } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

type FxMode = 'manual' | 'rate_375' | 'rate_380' | 'custom'

const OPTIONS: Array<{ mode: FxMode; en: string; ar: string; hint_en: string; hint_ar: string }> = [
  { mode: 'manual', en: 'Manual (per product)', ar: 'يدوي (لكل منتج)', hint_en: "Use each product's own USD price", hint_ar: 'استخدم سعر الدولار المكتوب لكل منتج' },
  { mode: 'rate_375', en: '3.75', ar: '٣.٧٥', hint_en: 'USD = SAR ÷ 3.75 (official peg)', hint_ar: 'الدولار = الريال ÷ ٣.٧٥ (السعر الرسمي)' },
  { mode: 'rate_380', en: '3.80', ar: '٣.٨٠', hint_en: 'USD = SAR ÷ 3.80', hint_ar: 'الدولار = الريال ÷ ٣.٨٠' },
  { mode: 'custom', en: 'Custom', ar: 'مخصّص', hint_en: 'Enter your own rate', hint_ar: 'أدخل سعر الصرف بنفسك' },
]

export function FxSettingsTab() {
  const { lang } = useLanguage()
  const ar = lang === 'ar'

  const [mode, setMode] = useState<FxMode>('manual')
  const [customRate, setCustomRate] = useState('3.75')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/fx')
        const j = await res.json()
        if (j.fx) {
          setMode(j.fx.mode)
          setCustomRate(String(j.fx.customRate ?? 3.75))
        }
      } catch {
        /* leave defaults */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/fx', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, customRate: Number(customRate) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || (ar ? 'فشل الحفظ' : 'Save failed'))
        return
      }
      toast.success(ar ? 'تم الحفظ' : 'Saved')
    } catch {
      toast.error(ar ? 'فشل الحفظ' : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-600" />
          {ar ? 'سعر صرف الدولار' : 'USD Exchange Rate'}
        </CardTitle>
        <CardDescription>
          {ar
            ? 'يُطبَّق عند تسعير مشاريع التنّور بالدولار — يحوّل سعر الريال تلقائياً.'
            : 'Applied when a Tannoor project is priced in USD — converts the SAR price automatically.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {ar ? 'جاري التحميل…' : 'Loading…'}
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => setMode(o.mode)}
                  className={`text-start rounded-lg border p-3 transition-colors ${
                    mode === o.mode
                      ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300'
                      : 'border-input hover:bg-muted/40'
                  }`}
                >
                  <div className="font-semibold text-sm">{ar ? o.ar : o.en}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{ar ? o.hint_ar : o.hint_en}</div>
                </button>
              ))}
            </div>

            {mode === 'custom' && (
              <div className="space-y-1.5">
                <Label>{ar ? 'سعر الصرف (ريال لكل دولار)' : 'Rate (SAR per USD)'}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.1"
                  dir="ltr"
                  value={customRate}
                  onChange={(e) => setCustomRate(e.target.value)}
                  className="max-w-[160px]"
                />
              </div>
            )}

            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {ar ? 'حفظ' : 'Save'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
