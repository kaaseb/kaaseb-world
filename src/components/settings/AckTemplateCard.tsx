'use client'

// Settings → the bilingual "we received your request / preparing your quotation"
// reply the inbox uses when converting an email to a project. Super-admin sets it
// once; the inbox reply composer prefills from it (still editable per-send).

import { useEffect, useState } from 'react'
import { Loader2, MailCheck, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export function AckTemplateCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [arSubject, setArSubject] = useState('')
  const [arBody, setArBody] = useState('')
  const [enSubject, setEnSubject] = useState('')
  const [enBody, setEnBody] = useState('')

  useEffect(() => {
    let alive = true
    const run = setTimeout(() => {
      fetch('/api/inbox/ack-template')
        .then((r) => r.json())
        .then((j) => {
          if (!alive || !j.template) return
          setArSubject(j.template.ar?.subject || ''); setArBody(j.template.ar?.body || '')
          setEnSubject(j.template.en?.subject || ''); setEnBody(j.template.en?.body || '')
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/inbox/ack-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: {
          ar: { subject: arSubject, body: arBody },
          en: { subject: enSubject, body: enBody },
        } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success('تم حفظ قالب الرد ✓')
    } catch { toast.error('فشل الحفظ') } finally { setSaving(false) }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <MailCheck className="w-4 h-4 text-emerald-600" />
          قالب رد صندوق الوارد («استلمنا طلبكم»)
        </CardTitle>
        <CardDescription>
          الرسالة التي تُرسل للعميل عند تحويل بريده لمشروع — عربي وإنجليزي. تظهر لك جاهزة في صندوق الوارد للمراجعة قبل الإرسال.
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
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-700">الموضوع (عربي)</span>
                  <input dir="rtl" value={arSubject} onChange={(e) => setArSubject(e.target.value)}
                    className="h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-700">النص العربي</span>
                  <textarea dir="rtl" rows={9} value={arBody} onChange={(e) => setArBody(e.target.value)}
                    className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 resize-y" />
                </label>
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-700">Subject (English)</span>
                  <input dir="ltr" value={enSubject} onChange={(e) => setEnSubject(e.target.value)}
                    className="h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-700">English text</span>
                  <textarea dir="ltr" rows={9} value={enBody} onChange={(e) => setEnBody(e.target.value)}
                    className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 resize-y" />
                </label>
              </div>
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
