'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, FileText, Plus, X, Loader2, ChevronUp, ChevronDown, Download, Upload, Trash2,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ImportantDocument } from '@/types'

interface Props {
  availableDocs: ImportantDocument[]
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

export function PreQualDesigner({ availableDocs }: Props) {
  const { t, isRtl } = useLanguage()
  const [companyEn,   setCompanyEn]   = useState('')
  const [companyAr,   setCompanyAr]   = useState('')
  const [projectEn,   setProjectEn]   = useState('')
  const [projectAr,   setProjectAr]   = useState('')
  const [picked,      setPicked]      = useState<string[]>([])
  const [creating,    setCreating]    = useState(false)
  const [rendering,   setRendering]   = useState(false)
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null)

  // Per-packet cover/back override (empty = use the default from Settings).
  const [hasDefaultCover, setHasDefaultCover] = useState(false)
  const [hasDefaultBack,  setHasDefaultBack]  = useState(false)
  const [overrideCover, setOverrideCover] = useState('')
  const [overrideBack,  setOverrideBack]  = useState('')
  const [uploadingTpl,  setUploadingTpl]  = useState<'cover' | 'back' | null>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const backRef  = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/prequal/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.templates) { setHasDefaultCover(!!j.templates.cover_url); setHasDefaultBack(!!j.templates.back_url) } })
      .catch(() => {})
  }, [])

  async function uploadTpl(which: 'cover' | 'back', file: File) {
    setUploadingTpl(which)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'prequal_template')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    setUploadingTpl(null)
    if (!j.url) { toast.error(j.error || 'Upload failed'); return }
    if (which === 'cover') setOverrideCover(j.url)
    else setOverrideBack(j.url)
  }

  const unpicked = availableDocs.filter(d => !picked.includes(d.id))

  function addDoc(id: string)    { setPicked(prev => [...prev, id]) }
  function removeDoc(id: string) { setPicked(prev => prev.filter(x => x !== id)) }
  function moveUp(id: string) {
    setPicked(prev => {
      const idx = prev.indexOf(id)
      if (idx <= 0) return prev
      const copy = [...prev]; [copy[idx-1], copy[idx]] = [copy[idx], copy[idx-1]]
      return copy
    })
  }
  function moveDown(id: string) {
    setPicked(prev => {
      const idx = prev.indexOf(id)
      if (idx < 0 || idx === prev.length - 1) return prev
      const copy = [...prev]; [copy[idx], copy[idx+1]] = [copy[idx+1], copy[idx]]
      return copy
    })
  }

  async function handleGenerate() {
    if (picked.length === 0) {
      toast.error(t('pq_pick_docs'))
      return
    }
    setCreating(true)
    // Step 1: create the pre-qual row
    const createRes = await fetch('/api/pre-qualifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_en: companyEn, company_ar: companyAr,
        project_name_en: projectEn, project_name_ar: projectAr,
        document_ids: picked,
        stamp_mode: 'none',
      }),
    })
    const created = await createRes.json()
    if (!createRes.ok) {
      setCreating(false)
      toast.error(created.error || 'Failed')
      return
    }

    // Step 1.5: if the user uploaded a custom cover/back for THIS packet, store
    // the override before rendering (else the default templates are used).
    if (overrideCover || overrideBack) {
      await fetch('/api/prequal/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pqId: created.item.id, cover_url: overrideCover || null, back_url: overrideBack || null }),
      }).catch(() => {})
    }

    // Step 2: render the merged PDF
    setRendering(true)
    const renderRes = await fetch(`/api/pre-qualifications/${created.item.id}/render`, {
      method: 'POST',
    })
    const rendered = await renderRes.json()
    setCreating(false)
    setRendering(false)
    if (!renderRes.ok) {
      toast.error(rendered.error || 'Rendering failed')
      return
    }
    setRenderedUrl(rendered.item.output_pdf_url)
    toast.success(t('pq_generate'))
  }

  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  const tplRow = (which: 'cover' | 'back', url: string, ref: React.RefObject<HTMLInputElement | null>, hasDefault: boolean, label: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadTpl(which, f); e.target.value = '' }}
      />
      {url ? (
        <div className="flex items-center justify-between gap-2 p-2 rounded border bg-muted/30 text-sm">
          <span className="flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />{isRtl ? 'ملف خاص' : 'Custom file'}</span>
          <div className="flex gap-1 flex-shrink-0">
            <Button type="button" size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={uploadingTpl === which}>
              {uploadingTpl === which ? <Loader2 className="w-4 h-4 animate-spin" /> : (isRtl ? 'تغيير' : 'Change')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => (which === 'cover' ? setOverrideCover('') : setOverrideBack(''))}>
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={uploadingTpl === which}
          className="w-full h-16 border-2 border-dashed rounded-lg flex items-center justify-center gap-2 text-muted-foreground hover:bg-muted/30 transition text-xs"
        >
          {uploadingTpl === which ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {hasDefault ? (isRtl ? 'افتراضي — أو ارفع خاص بهذا الملف' : 'Default — or upload a custom one') : (isRtl ? 'ارفع ملف' : 'Upload file')}
        </button>
      )}
    </div>
  )

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/pre-qualifications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('cp_back')}
      </Link>

      <h1 className="text-2xl md:text-3xl font-bold mb-6">{t('pq_new')}</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('pq_col_company')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('pq_company_en')}</Label>
                <Input value={companyEn} onChange={e => setCompanyEn(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('pq_company_ar')}</Label>
                <Input value={companyAr} onChange={e => setCompanyAr(e.target.value)} dir="rtl" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('pq_project_en')}</Label>
                <Input value={projectEn} onChange={e => setProjectEn(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('pq_project_ar')}</Label>
                <Input value={projectAr} onChange={e => setProjectAr(e.target.value)} dir="rtl" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('pq_pick_docs')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Picked documents in order */}
            <div className="space-y-1.5">
              {picked.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('pq_pick_docs')}
                </p>
              )}
              {picked.map((id, i) => {
                const doc = availableDocs.find(d => d.id === id)
                if (!doc) return null
                return (
                  <div key={id} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                    <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}</span>
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span className="text-sm flex-1 truncate">{display(doc.name_en, doc.name_ar, isRtl)}</span>
                    <button type="button" onClick={() => moveUp(id)} disabled={i === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => moveDown(id)} disabled={i === picked.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => removeDoc(id)} className="text-red-600 hover:text-red-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Available documents to add */}
            {unpicked.length > 0 && (
              <div className="border-t pt-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">{t('doc_title')}</p>
                {unpicked.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => addDoc(d.id)}
                    className="w-full flex items-center gap-2 p-2 rounded border bg-background hover:bg-muted text-start transition"
                  >
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <FileText className="w-4 h-4 text-blue-600" />
                    <span className="text-sm flex-1 truncate">{display(d.name_en, d.name_ar, isRtl)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Templates for THIS packet (optional override of the defaults) */}
      <Card className="border-0 shadow-sm mt-6">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{isRtl ? 'قوالب هذا الملف (اختياري)' : 'Templates for this packet (optional)'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isRtl
              ? 'افتراضياً يُستخدم الغلاف والخاتمة من الإعدادات. لو تبي غلافاً/خاتمة خاصة بهذا الملف فقط، ارفعها هنا.'
              : 'By default the cover and back from Settings are used. Upload a custom one for this packet only if you want.'}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {tplRow('cover', overrideCover, coverRef, hasDefaultCover, isRtl ? 'الغلاف (البداية)' : 'Cover (start)')}
            {tplRow('back', overrideBack, backRef, hasDefaultBack, isRtl ? 'الخاتمة (النهاية)' : 'Back (end)')}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <Button
          onClick={handleGenerate}
          disabled={creating || rendering || picked.length === 0}
          size="lg"
        >
          {creating || rendering
            ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('pq_generating')}</>
            : t('pq_generate')}
        </Button>
        {renderedUrl && (
          <a
            href={renderedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-background hover:bg-muted text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            {t('pq_download')}
          </a>
        )}
      </div>
    </div>
  )
}
