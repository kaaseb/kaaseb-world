'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, FileSpreadsheet, FileText, Image as ImageIcon,
  Loader2, Upload, X, Sparkles, Search, Link2, Briefcase,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ClientProject } from '@/types'

interface UploadedFile { url: string; name: string; key?: string; size?: number }

export function TannoorNewForm() {
  const { t, isRtl } = useLanguage()
  const router = useRouter()

  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [companyEn, setCompanyEn] = useState('')
  const [companyAr, setCompanyAr] = useState('')
  const [engEn, setEngEn] = useState('')
  const [engAr, setEngAr] = useState('')
  const [engPhone, setEngPhone] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [offerDuration, setOfferDuration] = useState('')
  const [specialConditions, setSpecialConditions] = useState('')

  const [boqFile, setBoqFile] = useState<UploadedFile | null>(null)
  const [specs, setSpecs] = useState<UploadedFile[]>([])
  const [drawings, setDrawings] = useState<UploadedFile[]>([])
  const [uploadingBoq, setUploadingBoq] = useState(false)
  const [uploadingSpec, setUploadingSpec] = useState(false)
  const [uploadingDrawing, setUploadingDrawing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Import from an existing /projects entry (same source Furn pulls from) ──
  const [clientProjects, setClientProjects] = useState<ClientProject[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [loadingClients, setLoadingClients] = useState(false)
  const [sourceId, setSourceId] = useState<string | null>(null)

  useEffect(() => {
    if (!pickerOpen || clientProjects !== null) return
    let alive = true
    // Deferred off the effect body so the initial setState isn't synchronous.
    const run = setTimeout(() => {
      setLoadingClients(true)
      fetch('/api/client-projects')
        .then((r) => r.json())
        .then((j) => { if (alive) setClientProjects((j.projects || []) as ClientProject[]) })
        .catch(() => { if (alive) setClientProjects([]) })
        .finally(() => { if (alive) setLoadingClients(false) })
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [pickerOpen, clientProjects])

  const filteredClients = useMemo(() => {
    if (!clientProjects) return []
    const q = pickerQuery.trim().toLowerCase()
    const base = q
      ? clientProjects.filter((p) => [p.name_en, p.name_ar, p.company_en, p.company_ar, p.engineer_name_en, p.engineer_name_ar, p.engineer_phone].filter(Boolean).join(' ').toLowerCase().includes(q))
      : clientProjects
    return base.slice(0, 50)
  }, [clientProjects, pickerQuery])

  // Apply a client project: fill BOTH languages, route files by category
  // (boq → BOQ slot, drawing → drawings, spec/other → specs).
  function importFromClientProject(cp: ClientProject) {
    setSourceId(cp.id)
    setNameEn(cp.name_en || cp.name_ar || '')
    setNameAr(cp.name_ar || cp.name_en || '')
    setCompanyEn(cp.company_en || cp.company_ar || '')
    setCompanyAr(cp.company_ar || cp.company_en || '')
    setEngEn(cp.engineer_name_en || cp.engineer_name_ar || '')
    setEngAr(cp.engineer_name_ar || cp.engineer_name_en || '')
    setEngPhone(cp.engineer_phone || '')

    let boq: UploadedFile | null = null
    const newSpecs: UploadedFile[] = []
    const newDrawings: UploadedFile[] = []
    for (const f of (cp.files || [])) {
      const up: UploadedFile = { url: f.url, name: f.name, size: typeof f.bytes === 'number' ? f.bytes : undefined }
      if (f.category === 'boq' && !boq) boq = up
      else if (f.category === 'drawing') newDrawings.push(up)
      else newSpecs.push(up) // spec, other, and any extra boq
    }
    if (boq) setBoqFile(boq)
    if (newSpecs.length) setSpecs((prev) => [...prev, ...newSpecs])
    if (newDrawings.length) setDrawings((prev) => [...prev, ...newDrawings])

    const imported = (cp.files || []).length
    toast.success(imported > 0 ? t('furn_imported_files_toast').replace('{n}', String(imported)) : t('furn_imported_no_files'))
    setPickerOpen(false)
    setPickerQuery('')
  }

  async function upload(file: File): Promise<UploadedFile | null> {
    const fd = new FormData()
    fd.append('file', file); fd.append('kind', 'tannoor')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json()
    if (!j.url) { toast.error(j.error || `Upload failed: ${file.name}`); return null }
    return { url: j.url, name: file.name, key: j.key, size: file.size }
  }
  async function handleBoq(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setUploadingBoq(true); const up = await upload(f); setUploadingBoq(false); e.target.value = ''
    if (up) setBoqFile(up)
  }
  async function handleSpec(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return
    setUploadingSpec(true)
    for (const f of files) { const up = await upload(f); if (up) setSpecs(prev => [...prev, up]) }
    setUploadingSpec(false); e.target.value = ''
  }
  async function handleDrawing(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []); if (!files.length) return
    setUploadingDrawing(true)
    for (const f of files) { const up = await upload(f); if (up) setDrawings(prev => [...prev, up]) }
    setUploadingDrawing(false); e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nameEn.trim() && !nameAr.trim()) { toast.error(t('cp_form_name_en')); return }
    if (!boqFile) { toast.error(t('furn_form_boq')); return }
    setSubmitting(true)
    const res = await fetch('/api/tannoor/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name_en: nameEn, project_name_ar: nameAr,
        company_en: companyEn, company_ar: companyAr,
        engineer_name_en: engEn, engineer_name_ar: engAr, engineer_phone: engPhone,
        payment_terms: paymentTerms, delivery_terms: deliveryTerms,
        offer_duration: offerDuration, special_conditions: specialConditions,
        boq_url: boqFile.url, boq_filename: boqFile.name,
        spec_files: specs, drawing_files: drawings,
      }),
    })
    const j = await res.json()
    if (!res.ok) { setSubmitting(false); toast.error(j.error || 'Failed'); return }
    toast.success(t('furn_form_submit'))
    router.push(`/tannoor/${j.project.id}`)
  }

  const ChevronEnd = isRtl ? ArrowLeft : ArrowRight
  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/tannoor" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('furn_back')}
      </Link>

      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t('tn_new_project')}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t('tn_subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Quick-start: pull everything (text + files) from an existing project —
            the same source Furn imports from, so the intake chain is consistent. */}
        <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center"><Sparkles className="w-4 h-4" /></span>
              {t('furn_quick_start')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sourceId ? (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
                <Link2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                <p className="flex-1 text-sm text-emerald-900 min-w-0 truncate">{t('furn_imported_from_client')}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSourceId(null)} className="text-emerald-700 gap-1">
                  <X className="w-4 h-4" /><span className="text-xs">{t('furn_unlink_import')}</span>
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-orange-700/60 ${isRtl ? 'right-3' : 'left-3'}`} />
                  <Input
                    value={pickerQuery}
                    onFocus={() => setPickerOpen(true)}
                    onChange={(e) => { setPickerQuery(e.target.value); setPickerOpen(true) }}
                    placeholder={t('furn_import_search_ph')}
                    className={`bg-white ${isRtl ? 'pr-10' : 'pl-10'}`}
                  />
                </div>
                {pickerOpen && (
                  <div className="rounded-lg bg-white border max-h-[320px] overflow-y-auto">
                    {loadingClients ? (
                      <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{t('loading')}</div>
                    ) : filteredClients.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground">{t('furn_import_no_match')}</div>
                    ) : (
                      <ul className="divide-y">
                        {filteredClients.map((cp) => {
                          const name = isRtl ? (cp.name_ar || cp.name_en) : (cp.name_en || cp.name_ar)
                          const company = isRtl ? (cp.company_ar || cp.company_en) : (cp.company_en || cp.company_ar)
                          const fileCount = (cp.files || []).length
                          return (
                            <li key={cp.id}>
                              <button type="button" onClick={() => importFromClientProject(cp)} className="w-full text-start px-3 py-2.5 hover:bg-orange-50/60 transition flex items-center gap-3">
                                <div className="w-9 h-9 rounded-md bg-muted/60 text-muted-foreground flex items-center justify-center flex-shrink-0"><Briefcase className="w-4 h-4" /></div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{name || '—'}</p>
                                  <p className="text-xs text-muted-foreground truncate">{[company, cp.engineer_phone].filter(Boolean).join(' · ')}</p>
                                </div>
                                {fileCount > 0 && <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-0.5"><FileText className="w-3 h-3" />{fileCount}</span>}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_form_project_name')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>{t('cp_form_name_en')} *</Label><Input value={nameEn} onChange={e => setNameEn(e.target.value)} dir="ltr" /></div>
              <div className="space-y-1.5"><Label>{t('cp_form_name_ar')} *</Label><Input value={nameAr} onChange={e => setNameAr(e.target.value)} dir="rtl" /></div>
              <div className="space-y-1.5"><Label>{t('cp_form_company_en')}</Label><Input value={companyEn} onChange={e => setCompanyEn(e.target.value)} dir="ltr" /></div>
              <div className="space-y-1.5"><Label>{t('cp_form_company_ar')}</Label><Input value={companyAr} onChange={e => setCompanyAr(e.target.value)} dir="rtl" /></div>
              <div className="space-y-1.5"><Label>{t('cp_form_engineer_en')}</Label><Input value={engEn} onChange={e => setEngEn(e.target.value)} dir="ltr" /></div>
              <div className="space-y-1.5"><Label>{t('cp_form_engineer_ar')}</Label><Input value={engAr} onChange={e => setEngAr(e.target.value)} dir="rtl" /></div>
              <div className="space-y-1.5 md:col-span-2"><Label>{t('cp_form_engineer_phone')}</Label><Input value={engPhone} onChange={e => setEngPhone(e.target.value)} dir="ltr" /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_form_payment_terms')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>{t('furn_form_payment_terms')}</Label><Textarea rows={2} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{t('furn_form_delivery_terms')}</Label><Textarea rows={2} value={deliveryTerms} onChange={e => setDeliveryTerms(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{t('furn_form_offer_duration')}</Label><Input value={offerDuration} onChange={e => setOfferDuration(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>{t('furn_form_special_conditions')}</Label><Textarea rows={2} value={specialConditions} onChange={e => setSpecialConditions(e.target.value)} /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_form_boq')} *</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {boqFile ? (
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm font-medium truncate">{boqFile.name}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBoqFile(null)}><X className="w-4 h-4" /></Button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/30 transition">
                {uploadingBoq ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <Upload className="w-6 h-6 text-muted-foreground" />}
                <p className="text-sm text-muted-foreground">{t('furn_form_boq_hint')}</p>
                <input type="file" accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.pdf" className="hidden" onChange={handleBoq} disabled={uploadingBoq} />
              </label>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_form_specs')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {specs.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                <div className="flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 text-blue-600" /><span className="text-sm truncate">{f.name}</span></div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSpecs(p => p.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
              </div>
            ))}
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-muted/30 transition">
              {uploadingSpec ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>{t('furn_form_specs')}</span>
              <input type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={handleSpec} disabled={uploadingSpec} />
            </label>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_form_drawings')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {drawings.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                <div className="flex items-center gap-2 min-w-0"><ImageIcon className="w-4 h-4 text-purple-600" /><span className="text-sm truncate">{f.name}</span></div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDrawings(p => p.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
              </div>
            ))}
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-muted/30 transition">
              {uploadingDrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>{t('furn_form_drawings')}</span>
              <input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="hidden" onChange={handleDrawing} disabled={uploadingDrawing} />
            </label>
          </CardContent>
        </Card>

        <Button type="submit" disabled={submitting || !boqFile} size="lg" className="w-full">
          {submitting
            ? <><Loader2 className={`w-5 h-5 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_form_submitting')}</>
            : <>{t('furn_form_submit')} <ChevronEnd className={`w-5 h-5 ${isRtl ? 'mr-2' : 'ml-2'}`} /></>}
        </Button>
      </form>
    </div>
  )
}
