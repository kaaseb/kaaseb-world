'use client'

// Settings → bulk broadcast: paste or upload a list of addresses and send ONE
// general "about KAASEB" message to all of them at once (BCC). Super-admin only.
// A deliberately heavy, confirm-gated action — this reaches many strangers.

import { useState } from 'react'
import { Loader2, Send, Upload, Users, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DEFAULT_BROADCAST_SUBJECT, DEFAULT_BROADCAST_BODY } from '@/lib/outreach/render'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function parseLocal(raw: string): { valid: string[]; invalid: number; duplicates: number } {
  const tokens = raw.split(/[\s,;<>()"'\[\]]+/).map((t) => t.trim()).filter(Boolean)
  const seen = new Set<string>()
  const valid: string[] = []
  let invalid = 0
  let duplicates = 0
  for (const t of tokens) {
    if (!EMAIL_RE.test(t)) { invalid++; continue }
    const k = t.toLowerCase()
    if (seen.has(k)) { duplicates++; continue }
    seen.add(k); valid.push(t)
  }
  return { valid, invalid, duplicates }
}

export function BroadcastCard() {
  const [emailsRaw, setEmailsRaw] = useState('')
  const [subject, setSubject] = useState(DEFAULT_BROADCAST_SUBJECT)
  const [body, setBody] = useState(DEFAULT_BROADCAST_BODY)
  const [attachProfile, setAttachProfile] = useState(true)
  const [sending, setSending] = useState(false)

  const { valid, invalid, duplicates } = parseLocal(emailsRaw)

  function onFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => setEmailsRaw((prev) => `${prev}\n${String(reader.result || '')}`.trim())
    reader.readAsText(file)
  }

  async function send() {
    if (valid.length === 0 || sending) return
    if (!confirm(`سيُرسل هذا التعريف إلى ${valid.length} عنوان بريد. متأكد؟`)) return
    setSending(true)
    try {
      const res = await fetch('/api/outreach/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, emails: valid, attachProfile }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الإرسال', { duration: 12000 }); return }
      toast.success(
        `تم الإرسال إلى ${j.sent} عنوان${j.failed ? ` (فشل ${j.failed})` : ''}${j.attached ? ' مع البروفايل' : ''} ✓`,
        { duration: 10000 },
      )
      setEmailsRaw('')
    } catch {
      toast.error('فشل الإرسال')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          إرسال جماعي — تعريف كاسب
        </CardTitle>
        <CardDescription>
          الصق أو ارفع قائمة إيميلات وأرسل لهم تعريف الشركة **دفعة واحدة**. المستلِمون في BCC (كل واحد ما يشوف الباقي).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700">قائمة الإيميلات (افصل بأي فاصل أو سطر)</span>
          <textarea
            dir="ltr" rows={5} value={emailsRaw} onChange={(e) => setEmailsRaw(e.target.value)}
            placeholder="a@x.com, b@y.com&#10;c@z.com"
            className="rounded-lg border border-gray-200 p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-emerald-700 font-medium flex items-center gap-1"><Users className="w-3.5 h-3.5" />{valid.length} صالح</span>
            {duplicates > 0 && <span className="text-muted-foreground">{duplicates} مكرر (حُذف)</span>}
            {invalid > 0 && <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{invalid} غير صالح (تُجوهل)</span>}
            <label className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white cursor-pointer hover:bg-muted/40 transition">
              <Upload className="w-3.5 h-3.5" /> ارفع ملف (txt/csv)
              <input type="file" accept=".txt,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
            </label>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700">الموضوع</span>
          <Input dir="ltr" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-700">النص (قابل للتعديل)</span>
          <textarea
            dir="ltr" rows={12} value={body} onChange={(e) => setBody(e.target.value)}
            className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={attachProfile} onChange={(e) => setAttachProfile(e.target.checked)} />
          إرفاق بروفايل الشركة (المرفوع في القالب أعلاه)
        </label>

        <Button onClick={send} disabled={valid.length === 0 || sending} className="gap-2">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'جاري الإرسال…' : `إرسال إلى ${valid.length} عنوان`}
        </Button>
      </CardContent>
    </Card>
  )
}
