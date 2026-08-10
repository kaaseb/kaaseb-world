'use client'

// Settings → super-admin toggle for the project-chat feature (floating launcher
// + the project detail chat tab). Enabled by default.

import { useEffect, useState } from 'react'
import { Loader2, MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export function ProjectChatCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/project-chat/settings')
      .then((r) => r.json())
      .then((j) => { if (alive) setEnabled(!!j.enabled) })
      .catch(() => { if (alive) setEnabled(true) })
    return () => { alive = false }
  }, [])

  async function toggle(next: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/project-chat/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل'); return }
      setEnabled(next)
      toast.success(next ? 'تم تفعيل دردشة المشاريع ✓' : 'تم إيقاف دردشة المشاريع')
    } catch { toast.error('فشل') } finally { setSaving(false) }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-blue-600" />
          دردشة المشاريع
        </CardTitle>
        <CardDescription>
          دردشة داخلية لكل مشروع (نص/صور/ملفات/تسجيل صوتي) — أيقونة عائمة + تبويب داخل المشروع. تظهر لمن له صلاحية المشاريع.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {enabled === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل…</div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-700">{enabled ? 'مُفعّلة' : 'مُوقفة'}</span>
            <button
              role="switch"
              aria-checked={enabled}
              disabled={saving}
              onClick={() => toggle(!enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'} ${saving ? 'opacity-60' : ''}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
