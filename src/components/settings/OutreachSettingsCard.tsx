'use client'

// Settings → outreach: the default English message sent to opportunities and
// target companies, plus the company-profile PDF attached to every send.
// Super-admin only (this text goes out under the company's name).

import { useEffect, useState } from 'react'
import { Loader2, Mail, Upload, Paperclip, Save, X, CloudCog } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { uploadFile } from '@/lib/upload-client'

export function OutreachSettingsCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [corsBusy, setCorsBusy] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [profileUrl, setProfileUrl] = useState<string | null>(null)
  const [profileName, setProfileName] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const run = setTimeout(() => {
      fetch('/api/outreach')
        .then((r) => r.json())
        .then((j) => {
          if (!alive || !j.template) return
          setSubject(j.template.subject || '')
          setBody(j.template.body || '')
          setProfileUrl(j.template.profileUrl || null)
          setProfileName(j.template.profileName || null)
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [])

  async function save(patch?: { profileUrl?: string | null; profileName?: string | null }) {
    setSaving(true)
    try {
      const res = await fetch('/api/outreach', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, ...patch }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success('تم حفظ قالب التواصل ✓')
    } catch {
      toast.error('فشل الحفظ')
    } finally {
      setSaving(false)
    }
  }

  // Goes browser → S3 directly (no nginx, no size ceiling); falls back to the
  // classic POST when the bucket's CORS hasn't been enabled yet.
  async function uploadProfile(file: File) {
    setUploading(true)
    try {
      const up = await uploadFile(file, 'outreach')
      setProfileUrl(up.url)
      setProfileName(file.name)
      await save({ profileUrl: up.url, profileName: file.name })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'فشل الرفع', { duration: 15000 })
    } finally {
      setUploading(false)
    }
  }

  // One-click: let the browser PUT straight to the bucket. Needed once, ever.
  async function enableDirectUpload() {
    setCorsBusy(true)
    try {
      const res = await fetch('/api/upload/cors', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الضبط', { duration: 15000 }); return }
      toast.success('تم تفعيل الرفع المباشر إلى S3 ✓ — جرّب الرفع الآن')
    } catch {
      toast.error('فشل الضبط')
    } finally {
      setCorsBusy(false)
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-600" />
          قالب رسالة التواصل
        </CardTitle>
        <CardDescription>
          الرسالة الإنجليزية اللي تُرسل للفرص والشركات المستهدفة، ومعها بروفايل الشركة.
          المتغيّرات: <code className="text-[11px]">{'{{contact}} {{company}} {{project}} {{city}}'}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">الموضوع (Subject)</span>
              <Input dir="ltr" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">نص الرسالة</span>
              <textarea
                dir="ltr" rows={14} value={body} onChange={(e) => setBody(e.target.value)}
                className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y"
              />
            </label>

            {/* Company profile attachment */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              {profileUrl ? (
                <>
                  <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 hover:underline truncate max-w-[240px]">
                    {profileName || 'البروفايل'}
                  </a>
                  <Button
                    type="button" variant="ghost" size="sm"
                    onClick={() => { setProfileUrl(null); setProfileName(null); void save({ profileUrl: null, profileName: null }) }}
                    className="text-muted-foreground hover:text-red-600 gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> إزالة
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground flex-1">ما فيه بروفايل مرفوع بعد</span>
              )}
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-white text-sm cursor-pointer hover:bg-muted/40 transition ms-auto">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {profileUrl ? 'استبدال' : 'ارفع البروفايل (PDF)'}
                <input
                  type="file" accept=".pdf" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadProfile(f); e.target.value = '' }}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => save()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ القالب
              </Button>
              {/* One-time: allows the browser to PUT straight to S3, which is
                  what makes big files immune to the proxy's 413. */}
              <Button variant="outline" onClick={enableDirectUpload} disabled={corsBusy} className="gap-2">
                {corsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudCog className="w-4 h-4" />}
                فعّل الرفع المباشر إلى S3
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              لو فشل رفع ملف كبير (خطأ 413)، اضغط «فعّل الرفع المباشر إلى S3» مرة واحدة — بعدها الملفات تروح من متصفحك
              إلى أمازون مباشرة بلا أي حد للحجم.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
