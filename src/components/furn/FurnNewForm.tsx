'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, Briefcase, ChevronDown, FileSpreadsheet, FileText,
  Image as ImageIcon, Layers, Link2, Loader2, Paperclip, Phone, Search,
  Sparkles, Upload, X,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ClientProject } from '@/types'

interface UploadedFile {
  url: string
  name: string
  size: number
}

interface PendingUpload {
  id: string
  name: string
  size: number
  percent: number
}

// The four buckets a file can live in. Files can be moved between buckets
// at any time via the per-row "move to" dropdown — useful after importing
// from a client project where we don't know which file is the BOQ.
type Bucket = 'boq' | 'spec' | 'drawing' | 'other'

const BUCKET_KEYS: Bucket[] = ['boq', 'spec', 'drawing', 'other']

// XHR-backed upload — needed for real progress events (fetch doesn't expose
// upload progress in any browser today). Returns the parsed JSON or throws.
function uploadWithProgress(
  file: File,
  kind: string,
  onProgress: (percent: number) => void,
): Promise<{ url: string; key?: string; bytes?: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) resolve(json)
        else reject(new Error(json.error || `HTTP ${xhr.status}`))
      } catch {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(fd)
  })
}

export function FurnNewForm() {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  // Optional source link — set when the user imports from /projects.
  // Stored so reviewers can trace the Furn quotation back to the original.
  const [sourceId, setSourceId] = useState<string | null>(null)

  const [projectName, setProjectName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [engineerName, setEngineerName] = useState('')
  const [engineerPhone, setEngineerPhone] = useState('')
  const [commercialRegister, setCommercialRegister] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  // Each terms field is captured in both languages so the AR and EN
  // quotation PDFs render with the right text. They're all optional —
  // empty fields fall back to the Furn-settings defaults at print time.
  const [paymentTermsAr, setPaymentTermsAr] = useState('')
  const [paymentTermsEn, setPaymentTermsEn] = useState('')
  const [deliveryTermsAr, setDeliveryTermsAr] = useState('')
  const [deliveryTermsEn, setDeliveryTermsEn] = useState('')
  const [offerDurationAr, setOfferDurationAr] = useState('')
  const [offerDurationEn, setOfferDurationEn] = useState('')
  const [specialConditionsAr, setSpecialConditionsAr] = useState('')
  const [specialConditionsEn, setSpecialConditionsEn] = useState('')

  // Per-bucket file state. BOQ is single, the rest are multi.
  const [boqFile, setBoqFile] = useState<UploadedFile | null>(null)
  const [specFiles, setSpecFiles] = useState<UploadedFile[]>([])
  const [drawingFiles, setDrawingFiles] = useState<UploadedFile[]>([])
  const [otherFiles, setOtherFiles] = useState<UploadedFile[]>([])
  // Pending uploads — keyed by bucket so we can render the progress bar in
  // the right card.
  const [pending, setPending] = useState<Record<Bucket, PendingUpload[]>>({
    boq: [], spec: [], drawing: [], other: [],
  })

  // Client-project picker state.
  const [clientProjects, setClientProjects] = useState<ClientProject[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [loadingClients, setLoadingClients] = useState(false)

  // Load the candidate list the first time the picker opens. Cheap enough
  // (≤ 500 rows) that we don't bother with server-side typeahead.
  useEffect(() => {
    if (!pickerOpen || clientProjects !== null) return
    let alive = true
    setLoadingClients(true)
    fetch('/api/client-projects')
      .then(r => r.json())
      .then(j => { if (alive) setClientProjects((j.projects || []) as ClientProject[]) })
      .catch(() => { if (alive) setClientProjects([]) })
      .finally(() => { if (alive) setLoadingClients(false) })
    return () => { alive = false }
  }, [pickerOpen, clientProjects])

  const filteredClients = useMemo(() => {
    if (!clientProjects) return []
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return clientProjects.slice(0, 50)
    return clientProjects.filter(p => {
      const hay = [
        p.name_en, p.name_ar, p.company_en, p.company_ar,
        p.engineer_name_en, p.engineer_name_ar, p.engineer_phone,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    }).slice(0, 50)
  }, [clientProjects, pickerQuery])

  // Apply a client project to the form. Files are routed by their
  // `category` field — BOQ → BOQ slot, spec → specs, drawing → drawings,
  // anything else → other. Files saved before the category field existed
  // fall into 'other' so nothing is lost. Text fields are unconditionally
  // overwritten — the user picked this source on purpose.
  function importFromClientProject(cp: ClientProject) {
    setSourceId(cp.id)
    setProjectName(cp.name_ar || cp.name_en || '')
    setCompanyName(cp.company_ar || cp.company_en || '')
    setEngineerName(cp.engineer_name_ar || cp.engineer_name_en || '')
    setEngineerPhone(cp.engineer_phone || '')

    let imported = 0
    for (const f of (cp.files || [])) {
      const uploaded: UploadedFile = {
        url: f.url,
        name: f.name,
        size: typeof f.bytes === 'number' ? f.bytes : 0,
      }
      imported++
      if (f.category === 'boq') setBoqFile(uploaded)
      else if (f.category === 'spec')    setSpecFiles(prev => [...prev, uploaded])
      else if (f.category === 'drawing') setDrawingFiles(prev => [...prev, uploaded])
      else                               setOtherFiles(prev => [...prev, uploaded])
    }
    if (imported > 0) {
      toast.success(t('furn_imported_files_toast').replace('{n}', String(imported)))
    } else {
      toast.success(t('furn_imported_no_files'))
    }
    setPickerOpen(false)
    setPickerQuery('')
  }

  function clearImport() {
    setSourceId(null)
    toast.success(t('furn_import_cleared'))
  }

  async function handleUpload(bucket: Bucket, fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    for (const f of files) {
      const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setPending(prev => ({
        ...prev,
        [bucket]: [...prev[bucket], { id: pendingId, name: f.name, size: f.size, percent: 0 }],
      }))
      try {
        const result = await uploadWithProgress(f, 'furn', (pct) => {
          setPending(prev => ({
            ...prev,
            [bucket]: prev[bucket].map(p => p.id === pendingId ? { ...p, percent: pct } : p),
          }))
        })
        if (!result.url) throw new Error(result.error || 'Upload failed')
        const uploaded: UploadedFile = { url: result.url, name: f.name, size: f.size }
        if (bucket === 'boq') setBoqFile(uploaded)
        else if (bucket === 'spec') setSpecFiles(prev => [...prev, uploaded])
        else if (bucket === 'drawing') setDrawingFiles(prev => [...prev, uploaded])
        else setOtherFiles(prev => [...prev, uploaded])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Upload failed: ${f.name}`)
      } finally {
        setPending(prev => ({
          ...prev,
          [bucket]: prev[bucket].filter(p => p.id !== pendingId),
        }))
      }
    }
  }

  // Move a file from one bucket to another. Used by the per-row "move to"
  // dropdown so the user can re-categorize imported files.
  function moveFile(from: Bucket, idx: number, to: Bucket) {
    if (from === to) return
    let file: UploadedFile | null = null
    if (from === 'boq') { file = boqFile; setBoqFile(null) }
    else if (from === 'spec')    { file = specFiles[idx] || null;    setSpecFiles(prev => prev.filter((_, i) => i !== idx)) }
    else if (from === 'drawing') { file = drawingFiles[idx] || null; setDrawingFiles(prev => prev.filter((_, i) => i !== idx)) }
    else                         { file = otherFiles[idx] || null;   setOtherFiles(prev => prev.filter((_, i) => i !== idx)) }
    if (!file) return
    if (to === 'boq')        setBoqFile(file)
    else if (to === 'spec')  setSpecFiles(prev => [...prev, file!])
    else if (to === 'drawing') setDrawingFiles(prev => [...prev, file!])
    else                     setOtherFiles(prev => [...prev, file!])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Only the BOQ is mandatory now. Name/company/engineer/phone are
    // expected to be pulled from the client project on import, and the
    // server accepts placeholders so the project can still be saved when
    // the team imports a project that's only partly filled out.
    if (!boqFile) {
      toast.error(t('furn_form_boq_required'))
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/furn/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name: projectName.trim() || (boqFile.name || 'Untitled project'),
        company_name: companyName.trim() || '—',
        engineer_name: engineerName,
        engineer_phone: engineerPhone,
        commercial_register: commercialRegister,
        tax_number: taxNumber,
        // Single-language fields kept for back-compat with old quotations
        // that hadn't split yet. The bilingual fields below are what the
        // PDF actually reads.
        payment_terms: paymentTermsAr || paymentTermsEn,
        delivery_terms: deliveryTermsAr || deliveryTermsEn,
        offer_duration: offerDurationAr || offerDurationEn,
        special_conditions: specialConditionsAr || specialConditionsEn,
        payment_terms_ar: paymentTermsAr,
        payment_terms_en: paymentTermsEn,
        delivery_terms_ar: deliveryTermsAr,
        delivery_terms_en: deliveryTermsEn,
        offer_duration_ar: offerDurationAr,
        offer_duration_en: offerDurationEn,
        special_conditions_ar: specialConditionsAr,
        special_conditions_en: specialConditionsEn,
        boq_url: boqFile.url,
        boq_filename: boqFile.name,
        spec_files: specFiles.map(f => ({ url: f.url, name: f.name })),
        drawing_files: drawingFiles.map(f => ({ url: f.url, name: f.name })),
        other_files: otherFiles.map(f => ({ url: f.url, name: f.name })),
        source_client_project_id: sourceId,
      }),
    })
    const j = await res.json()
    if (!res.ok) {
      setSubmitting(false)
      toast.error(j.error || 'Failed')
      return
    }
    toast.success(t('furn_form_submit'))
    router.push(`/furn/${j.project.id}`)
  }

  const ChevronEnd = isRtl ? ArrowLeft : ArrowRight
  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/furn" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('furn_back')}
      </Link>

      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t('furn_new_project')}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t('furn_subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Quick-start: pull everything (text + files) from an existing
            client project. Designed to be the first thing the eye lands on
            so the user reaches for it before retyping data they already
            entered in /projects. */}
        <ClientProjectImportCard
          query={pickerQuery}
          setQuery={setPickerQuery}
          loading={loadingClients}
          results={filteredClients}
          onOpen={() => setPickerOpen(true)}
          opened={pickerOpen}
          onPick={importFromClientProject}
          sourceId={sourceId}
          onClear={clearImport}
          isRtl={isRtl}
          t={t}
        />

        {/* Project basics — every field below is optional now. When the
            user imports from /projects, they all fill themselves in. */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('furn_form_project_name')}</CardTitle>
            <CardDescription className="text-xs">{t('furn_form_basics_hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t('furn_form_project_name')}</Label>
                <Input
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder={t('furn_form_project_name_ph')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('furn_form_company_name')}</Label>
                <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('furn_form_engineer_name')}</Label>
                <Input value={engineerName} onChange={e => setEngineerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('furn_form_engineer_phone')}</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9+\s]*"
                  value={engineerPhone}
                  onChange={e => setEngineerPhone(e.target.value.replace(/[^\d+\s]/g, ''))}
                  dir="ltr"
                  placeholder="+966 5XX XXX XXX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('furn_form_commercial_register')}</Label>
                <Input value={commercialRegister} onChange={e => setCommercialRegister(e.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t('furn_form_tax_number')}</Label>
                <Input value={taxNumber} onChange={e => setTaxNumber(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Terms — bilingual. Each row shows the Arabic field on one
            side and the English field on the other so the team can fill
            both without scrolling, and the AR/EN PDFs each render with
            the matching text. */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('furn_form_terms')}</CardTitle>
            <CardDescription className="text-xs">{t('furn_form_payment_terms_hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <BilingualTerm
              label={t('furn_form_offer_duration')}
              en={offerDurationEn} ar={offerDurationAr}
              setEn={setOfferDurationEn} setAr={setOfferDurationAr}
              isLong={false}
            />
            <BilingualTerm
              label={t('furn_form_delivery_terms')}
              en={deliveryTermsEn} ar={deliveryTermsAr}
              setEn={setDeliveryTermsEn} setAr={setDeliveryTermsAr}
              isLong
            />
            <BilingualTerm
              label={t('furn_form_payment_terms')}
              en={paymentTermsEn} ar={paymentTermsAr}
              setEn={setPaymentTermsEn} setAr={setPaymentTermsAr}
              isLong
            />
            <BilingualTerm
              label={t('furn_form_special_conditions')}
              en={specialConditionsEn} ar={specialConditionsAr}
              setEn={setSpecialConditionsEn} setAr={setSpecialConditionsAr}
              isLong
            />
          </CardContent>
        </Card>

        {/* Files — 4 buckets. Each row carries a "move to" dropdown so
            imported files can be re-categorized after the fact. */}
        <FileBucketCard
          title={`${t('furn_form_boq')} *`}
          hint={t('furn_form_boq_hint')}
          icon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
          accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.pdf"
          multiple={false}
          files={boqFile ? [boqFile] : []}
          pending={pending.boq}
          onFiles={(fl) => handleUpload('boq', fl)}
          onRemove={() => setBoqFile(null)}
          onMove={(_idx, to) => moveFile('boq', 0, to)}
          bucket="boq"
          t={t}
        />

        <FileBucketCard
          title={t('furn_form_specs')}
          hint={t('furn_form_specs_hint')}
          icon={<FileText className="w-4 h-4 text-blue-600" />}
          accept=".pdf,.doc,.docx"
          multiple
          files={specFiles}
          pending={pending.spec}
          onFiles={(fl) => handleUpload('spec', fl)}
          onRemove={(i) => setSpecFiles(prev => prev.filter((_, j) => j !== i))}
          onMove={(idx, to) => moveFile('spec', idx, to)}
          bucket="spec"
          t={t}
        />

        <FileBucketCard
          title={t('furn_form_drawings')}
          hint={t('furn_form_drawings_hint')}
          icon={<ImageIcon className="w-4 h-4 text-purple-600" />}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          multiple
          files={drawingFiles}
          pending={pending.drawing}
          onFiles={(fl) => handleUpload('drawing', fl)}
          onRemove={(i) => setDrawingFiles(prev => prev.filter((_, j) => j !== i))}
          onMove={(idx, to) => moveFile('drawing', idx, to)}
          bucket="drawing"
          t={t}
        />

        <FileBucketCard
          title={t('furn_form_other')}
          hint={t('furn_form_other_hint')}
          icon={<Paperclip className="w-4 h-4 text-amber-600" />}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt"
          multiple
          files={otherFiles}
          pending={pending.other}
          onFiles={(fl) => handleUpload('other', fl)}
          onRemove={(i) => setOtherFiles(prev => prev.filter((_, j) => j !== i))}
          onMove={(idx, to) => moveFile('other', idx, to)}
          bucket="other"
          t={t}
        />

        <Button type="submit" disabled={submitting || !boqFile} size="lg" className="w-full bg-orange-600 hover:bg-orange-700 text-white">
          {submitting
            ? <><Loader2 className={`w-5 h-5 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_form_submitting')}</>
            : <>{t('furn_form_submit')} <ChevronEnd className={`w-5 h-5 ${isRtl ? 'mr-2' : 'ml-2'}`} /></>}
        </Button>
      </form>
    </div>
  )
}

// ─── BilingualTerm ───────────────────────────────────────────────────────
// Renders one terms field as an AR + EN pair. The two inputs share a
// label and live on the same row on desktop, stacked on mobile.
//
// IMPORTANT: the Input/Textarea elements are rendered inline here on
// purpose. Wrapping them in a `const Field = isLong ? ... : ...` defined
// inside this function would re-create the component *type* on every
// keystroke, which React reads as "unmount and remount the input",
// trashing focus and selection after every character. Inline JSX keeps
// React's reconciler happy and the cursor where the user left it.
function BilingualTerm({
  label, en, ar, setEn, setAr, isLong,
}: {
  label: string
  en: string
  ar: string
  setEn: (v: string) => void
  setAr: (v: string) => void
  isLong: boolean
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <div className="grid md:grid-cols-2 gap-3">
        {isLong ? (
          <Textarea rows={2} value={ar} onChange={e => setAr(e.target.value)} dir="rtl" placeholder="بالعربية" />
        ) : (
          <Input value={ar} onChange={e => setAr(e.target.value)} dir="rtl" placeholder="بالعربية" />
        )}
        {isLong ? (
          <Textarea rows={2} value={en} onChange={e => setEn(e.target.value)} dir="ltr" placeholder="In English" />
        ) : (
          <Input value={en} onChange={e => setEn(e.target.value)} dir="ltr" placeholder="In English" />
        )}
      </div>
    </div>
  )
}

// ─── ClientProjectPicker ─────────────────────────────────────────────────
// Native dropdown anchored next to the project-name field. Type to filter
// the cached client-project list, click to import.
// ─── ClientProjectImportCard ────────────────────────────────────────────
// Full-width hero card at the top of the form. Two states:
//   • Idle  → big call-to-action "Import from a project" with a search input.
//   • Opened → list of matching projects rendered as rich rows (name,
//     company, engineer, phone, file count). Clicking imports.
// After import we show a compact "linked" pill with an unlink button.
function ClientProjectImportCard({
  query, setQuery, loading, results, onOpen, opened, onPick, sourceId,
  onClear, isRtl, t,
}: {
  query: string
  setQuery: (q: string) => void
  loading: boolean
  results: ClientProject[]
  onOpen: () => void
  opened: boolean
  onPick: (cp: ClientProject) => void
  sourceId: string | null
  onClear: () => void
  isRtl: boolean
  t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string
}) {
  // After import, collapse into a slim badge. The user can unlink to
  // start over.
  if (sourceId) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
            <Link2 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-900">
              {t('furn_imported_from_client')}
            </p>
            <p className="text-xs text-emerald-800/70">
              {t('furn_import_change_hint')}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onClear} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
            <span className="text-xs">{t('furn_unlink_import')}</span>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          {t('furn_quick_start')}
        </CardTitle>
        <CardDescription className="text-xs text-orange-900/70">
          {t('furn_quick_start_hint')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="relative">
          <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-orange-700/60 ${isRtl ? 'right-3' : 'left-3'}`} />
          <Input
            value={query}
            onFocus={onOpen}
            onChange={e => { setQuery(e.target.value); onOpen() }}
            placeholder={t('furn_import_search_ph')}
            className={`bg-white ${isRtl ? 'pr-10' : 'pl-10'}`}
          />
        </div>

        {/* Result list. Only renders when the user has opened the picker
            (focused the input or typed) — empty state on first load is
            clean. */}
        {opened && (
          <div className="rounded-lg bg-white border max-h-[320px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('loading')}
              </div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {t('furn_import_no_match')}
              </div>
            ) : (
              <ul className="divide-y">
                {results.map(cp => <ProjectResultRow key={cp.id} cp={cp} onPick={onPick} isRtl={isRtl} t={t} />)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProjectResultRow({ cp, onPick, isRtl, t }: {
  cp: ClientProject
  onPick: (cp: ClientProject) => void
  isRtl: boolean
  t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string
}) {
  const name = isRtl ? (cp.name_ar || cp.name_en) : (cp.name_en || cp.name_ar)
  const company = isRtl ? (cp.company_ar || cp.company_en) : (cp.company_en || cp.company_ar)
  const engineer = isRtl ? (cp.engineer_name_ar || cp.engineer_name_en) : (cp.engineer_name_en || cp.engineer_name_ar)
  const fileCount = (cp.files || []).length
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(cp)}
        className="w-full text-start px-3 py-2.5 hover:bg-orange-50/60 transition flex items-start gap-3"
      >
        <div className="w-9 h-9 rounded-md bg-muted/60 text-muted-foreground flex items-center justify-center flex-shrink-0">
          <Briefcase className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{name || '—'}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
            {company && <span className="truncate">{company}</span>}
            {engineer && <span className="truncate">· {engineer}</span>}
            {cp.engineer_phone && (
              <span className="inline-flex items-center gap-0.5" dir="ltr">
                <Phone className="w-3 h-3" />{cp.engineer_phone}
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded flex-shrink-0">
          {fileCount} {t('furn_files_count')}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5 ${isRtl ? 'rotate-90' : '-rotate-90'}`}
        />
      </button>
    </li>
  )
}

// ─── FileBucketCard ──────────────────────────────────────────────────────
// One card per bucket (BOQ / specs / drawings / other). Shows uploaded
// files with a "move to" picker and any in-progress upload bars.
function FileBucketCard({
  title, hint, icon, accept, multiple, files, pending, onFiles, onRemove,
  onMove, bucket, t,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  accept: string
  multiple: boolean
  files: UploadedFile[]
  pending: PendingUpload[]
  onFiles: (files: FileList | File[]) => void
  onRemove: (idx: number) => void
  onMove: (idx: number, to: Bucket) => void
  bucket: Bucket
  t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string
}) {
  const fullForSingle = !multiple && files.length > 0
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {files.map((f, i) => (
          <FileRow
            key={`${f.url}-${i}`}
            file={f}
            onRemove={() => onRemove(i)}
            onMove={(to) => onMove(i, to)}
            currentBucket={bucket}
            t={t}
          />
        ))}

        {pending.map(p => (
          <div key={p.id} className="p-2 rounded border bg-muted/20">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
                <span className="text-sm truncate" title={p.name}>{p.name}</span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">{p.percent}%</span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-150"
                style={{ width: `${p.percent}%` }}
              />
            </div>
          </div>
        ))}

        {!fullForSingle && (
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-muted/30 transition">
            <Upload className="w-4 h-4" />
            <span>{t('furn_upload')}</span>
            <input
              type="file"
              accept={accept}
              multiple={multiple}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </CardContent>
    </Card>
  )
}

function FileRow({ file, onRemove, onMove, currentBucket, t }: {
  file: UploadedFile
  onRemove: () => void
  onMove: (to: Bucket) => void
  currentBucket: Bucket
  t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string
}) {
  const labelFor = (b: Bucket): string =>
    b === 'boq'      ? t('furn_form_boq')
  : b === 'spec'     ? t('furn_form_specs')
  : b === 'drawing'  ? t('furn_form_drawings')
                     : t('furn_form_other')
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded border bg-muted/30">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm truncate hover:underline"
          title={file.name}
        >
          {file.name}
        </a>
        {file.size > 0 && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* "Move to" picker — styled like a small select. Disabled options
            include the current bucket so the user can't move into itself. */}
        <label className="relative inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs cursor-pointer hover:bg-muted/40">
          <Layers className="w-3 h-3" />
          <span>{t('furn_move_to')}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
          <select
            value={currentBucket}
            onChange={(e) => onMove(e.target.value as Bucket)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label={t('furn_move_to')}
          >
            {BUCKET_KEYS.map(b => (
              <option key={b} value={b} disabled={b === currentBucket}>
                {labelFor(b)}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
