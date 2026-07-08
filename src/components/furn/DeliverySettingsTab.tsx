'use client'

// Super-admin panel: the fixed "delivery included" sentence printed on the
// quotation when the team marks a project as delivery-included. (The
// "not included" case is a shipping PRICE entered per project, not a sentence,
// so it has no setting here.) Bilingual, stored locally via /api/furn/delivery.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Save, Truck } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Presets {
  included_ar: string
  included_en: string
}

export function DeliverySettingsTab() {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const [p, setP] = useState<Presets | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/furn/delivery')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.presets) setP({ included_ar: j.presets.included_ar || '', included_en: j.presets.included_en || '' }) })
      .catch(() => {})
  }, [])

  function set<K extends keyof Presets>(k: K, v: string) {
    setP(prev => (prev ? { ...prev, [k]: v } : prev))
  }

  async function save() {
    if (!p) return
    setSaving(true)
    const res = await fetch('/api/furn/delivery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })
    setSaving(false)
    if (!res.ok) { toast.error(ar ? 'فشل الحفظ' : 'Save failed'); return }
    toast.success(ar ? 'تم الحفظ' : 'Saved')
  }

  if (!p) return null

  return (
    <Card dir={isRtl ? 'rtl' : 'ltr'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" />
          {ar ? 'جملة "شامل التوصيل"' : 'Delivery-included sentence'}
        </CardTitle>
        <CardDescription>
          {ar
            ? 'تظهر في عرض السعر عند اختيار "شامل التوصيل" للمشروع. (خيار "غير شامل" تُدخل فيه قيمة شحن داخل المشروع وتُضاف للإجمالي.)'
            : 'Printed on the quotation when a project is marked "delivery included". ("Not included" takes a shipping amount per project, added to the total.)'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{ar ? 'الجملة (عربي)' : 'Sentence (Arabic)'}</Label>
            <Textarea dir="rtl" rows={2} value={p.included_ar} onChange={e => set('included_ar', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{ar ? 'الجملة (إنجليزي)' : 'Sentence (English)'}</Label>
            <Textarea dir="ltr" rows={2} value={p.included_en} onChange={e => set('included_en', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving
              ? <><Loader2 className="w-4 h-4 me-2 animate-spin" />{ar ? 'جارٍ الحفظ' : 'Saving'}</>
              : <><Save className="w-4 h-4 me-2" />{ar ? 'حفظ' : 'Save'}</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
