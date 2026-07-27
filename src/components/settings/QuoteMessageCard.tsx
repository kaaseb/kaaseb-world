'use client'

// Settings → the bilingual cover message attached when a quotation PDF is
// emailed to a client. Edit by hand or draft with AI. Super-admin only.

import { useEffect, useState } from 'react'
import { Loader2, Mail, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export function QuoteMessageCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [ar, setAr] = useState('')
  const [en, setEn] = useState('')

  useEffect(() => {
    let alive = true
    const run = setTimeout(() => {
      fetch('/api/furn/quote-message')
        .then((r) => r.json())
        .then((j) => { if (alive && j.message) { setAr(j.message.ar || ''); setEn(j.message.en || '') } })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/furn/quote-message', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ar, en }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success('تم حفظ رسالة العرض ✓')
    } catch { toast.error('فشل الحفظ') } finally { setSaving(false) }
  }

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/furn/quote-message/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل التوليد', { duration: 10000 }); return }
      if (j.message) { setAr(j.message.ar || ''); setEn(j.message.en || '') }
      toast.success('تم توليد الرسالة بالذكاء ✓')
    } catch { toast.error('فشل التوليد') } finally { setGenerating(false) }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-orange-600" />
          رسالة العرض السعري (تُرفق مع الـPDF)
        </CardTitle>
        <CardDescription>
          نص الرسالة الذي يُرسل مع عرض السعر — عربي وإنجليزي. الموضوع يأتي من «الكلمات المفتاحية» في المشروع.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-700">النص العربي</span>
                <textarea dir="rtl" rows={10} value={ar} onChange={(e) => setAr(e.target.value)}
                  className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 resize-y" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-700">English text</span>
                <textarea dir="ltr" rows={10} value={en} onChange={(e) => setEn(e.target.value)}
                  className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 resize-y" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
              </Button>
              <Button variant="outline" onClick={generate} disabled={generating} className="gap-2">
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} توليد بالذكاء
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
