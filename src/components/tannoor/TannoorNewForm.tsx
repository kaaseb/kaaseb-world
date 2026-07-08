'use client'

import { useState } from 'react'
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
  Loader2, Upload, X,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

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
