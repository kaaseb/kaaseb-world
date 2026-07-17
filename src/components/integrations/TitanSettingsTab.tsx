'use client'

// Super-admin panel: Titan email (IMAP) credentials for pulling customer
// project emails. Titan has no API key — it's a mailbox login over IMAP — so the
// two account-side prerequisites are spelled out here, because they fail
// silently otherwise.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Mail, Loader2, Save, PlugZap, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface TitanPublic {
  enabled: boolean
  host: string
  port: number
  email: string
  has_password: boolean
  folder: string
}

export function TitanSettingsTab() {
  const { lang } = useLanguage()
  const ar = lang === 'ar'

  const [s, setS] = useState<TitanPublic | null>(null)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/integrations/titan')
        const j = await res.json()
        if (j.titan) setS(j.titan)
      } catch {
        /* leave null */
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function patch(p: Partial<TitanPublic>) {
    setS((prev) => (prev ? { ...prev, ...p } : prev))
  }

  async function save() {
    if (!s) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        enabled: s.enabled, host: s.host, port: s.port, email: s.email, folder: s.folder,
      }
      // Only send the password when the admin typed a new one.
      if (password) body.password = password
      const res = await fetch('/api/integrations/titan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || (ar ? 'فشل الحفظ' : 'Save failed'))
        return
      }
      if (j.titan) setS(j.titan)
      setPassword('')
      toast.success(ar ? 'تم الحفظ' : 'Saved')
    } catch {
      toast.error(ar ? 'فشل الحفظ' : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/titan/test', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || (ar ? 'فشل الاتصال' : 'Connection failed'), { duration: 12000 })
        return
      }
      toast.success(
        ar ? `الاتصال ناجح — ${j.messages} رسالة في ${j.mailbox}` : `Connected — ${j.messages} messages in ${j.mailbox}`,
      )
    } catch {
      toast.error(ar ? 'فشل الاتصال' : 'Connection failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          {ar ? 'بريد Titan (سحب المشاريع)' : 'Titan Email (project intake)'}
        </CardTitle>
        <CardDescription>
          {ar
            ? 'يسحب إيميلات العملاء ومرفقاتها من صندوق Titan إلى "صندوق الوارد"، ومنها تحوّلها لمشروع.'
            : 'Pulls customer emails + attachments from your Titan mailbox into the Inbox, ready to convert into a project.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !s ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {ar ? 'جاري التحميل…' : 'Loading…'}
          </div>
        ) : (
          <>
            {/* Titan has no API key — two account-side switches make or break it */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {ar ? 'قبل ما تبدأ — في حساب Titan:' : 'Before you start — in your Titan account:'}
              </p>
              <ol className="mt-1.5 space-y-0.5 list-decimal ms-5">
                <li>{ar ? 'فعّل "Third-party access" (الوصول من تطبيقات خارجية)' : 'Enable "Third-party access"'}</li>
                <li>{ar ? 'أوقف المصادقة الثنائية (2FA)' : 'Disable two-factor authentication (2FA)'}</li>
              </ol>
              <p className="mt-1.5 text-xs">
                {ar ? 'Titan ما عنده مفتاح API — نستخدم الإيميل وكلمة المرور عبر IMAP.' : 'Titan has no API key — we use your email + password over IMAP.'}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
                className="w-4 h-4"
              />
              {ar ? 'تفعيل السحب من Titan' : 'Enable Titan intake'}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{ar ? 'الإيميل' : 'Email'}</Label>
                <Input dir="ltr" value={s.email} onChange={(e) => patch({ email: e.target.value })} placeholder="you@yourdomain.com" />
              </div>
              <div className="space-y-1.5">
                <Label>{ar ? 'كلمة المرور' : 'Password'}</Label>
                <Input
                  dir="ltr"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={s.has_password ? (ar ? '•••••• (محفوظة)' : '•••••• (saved)') : ''}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{ar ? 'الخادم (IMAP)' : 'IMAP host'}</Label>
                <Input dir="ltr" value={s.host} onChange={(e) => patch({ host: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{ar ? 'المنفذ' : 'Port'}</Label>
                <Input dir="ltr" type="number" value={s.port} onChange={(e) => patch({ port: Number(e.target.value) })} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {ar ? 'حفظ' : 'Save'}
              </Button>
              <Button variant="outline" onClick={test} disabled={testing} className="gap-2">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
                {ar ? 'اختبار الاتصال' : 'Test connection'}
              </Button>
              {s.has_password && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {ar ? 'كلمة المرور محفوظة' : 'Password saved'}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
