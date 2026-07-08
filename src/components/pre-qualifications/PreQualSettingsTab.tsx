'use client'

// Super-admin panel: the fixed cover + back template files that wrap every
// pre-qualification packet, plus the auto-TOC title. Files (PDF or image, 1+
// pages) are uploaded to S3; only the urls are stored. Change them anytime.

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { FileSignature, Upload, Loader2, Save, FileText, Trash2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Templates {
  cover_url: string | null
  back_url: string | null
  toc_title_ar: string
  toc_title_en: string
}

export function PreQualSettingsTab() {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const [tpl, setTpl] = useState<Templates | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'cover' | 'back' | null>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/prequal/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.templates) setTpl(j.templates) })
      .catch(() => {})
  }, [])

  function set<K extends keyof Templates>(k: K, v: Templates[K]) {
    setTpl(prev => (prev ? { ...prev, [k]: v } : prev))
  }

  async function upload(which: 'cover' | 'back', file: File) {
    setUploading(which)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'prequal_template')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    setUploading(null)
    if (!j.url) { toast.error(j.error || 'Upload failed'); return }
    set(which === 'cover' ? 'cover_url' : 'back_url', j.url)
  }

  async function save() {
    if (!tpl) return
    setSaving(true)
    const res = await fetch('/api/prequal/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tpl),
    })
    setSaving(false)
    if (!res.ok) { toast.error(ar ? 'فشل الحفظ' : 'Save failed'); return }
    toast.success(ar ? 'تم الحفظ' : 'Saved')
  }

  if (!tpl) return null

  const fileRow = (which: 'cover' | 'back', url: string | null, ref: React.RefObject<HTMLInputElement | null>, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(which, f); e.target.value = '' }}
      />
      {url ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border bg-muted/30">
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 min-w-0 text-sm hover:underline">
            <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="truncate">{ar ? 'الملف الحالي' : 'Current file'}</span>
          </a>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={uploading === which}>
              {uploading === which ? <Loader2 className="w-4 h-4 animate-spin" /> : (ar ? 'تغيير' : 'Change')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => set(which === 'cover' ? 'cover_url' : 'back_url', null)}>
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={uploading === which}
          className="w-full h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/30 transition"
        >
          {uploading === which ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
          <span className="text-xs">PDF / {ar ? 'صورة' : 'Image'}</span>
        </button>
      )}
    </div>
  )

  return (
    <Card dir={isRtl ? 'rtl' : 'ltr'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="w-5 h-5 text-primary" />
          {ar ? 'قوالب التأهيل المسبق' : 'Pre-qualification templates'}
        </CardTitle>
        <CardDescription>
          {ar
            ? 'الغلاف (الصفحة الأولى) والخاتمة (الصفحة الأخيرة) الثابتة. كل ملف تأهيل يطلع: الغلاف ← جدول محتويات تلقائي ← الملفات المختارة ← الخاتمة.'
            : 'The fixed cover (first page) and back (last page). Every packet renders: cover → auto Table of Contents → chosen documents → back.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          {fileRow('cover', tpl.cover_url, coverRef, ar ? 'ملف الغلاف (البداية)' : 'Cover file (start)')}
          {fileRow('back', tpl.back_url, backRef, ar ? 'ملف الخاتمة (النهاية)' : 'Back file (end)')}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{ar ? 'عنوان جدول المحتويات (عربي)' : 'TOC title (Arabic)'}</Label>
            <Input dir="rtl" value={tpl.toc_title_ar} onChange={e => set('toc_title_ar', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{ar ? 'عنوان جدول المحتويات (إنجليزي)' : 'TOC title (English)'}</Label>
            <Input dir="ltr" value={tpl.toc_title_en} onChange={e => set('toc_title_en', e.target.value)} />
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
