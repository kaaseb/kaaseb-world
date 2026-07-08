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
  ArrowLeft, ArrowRight, ChevronDown, Download, FileSpreadsheet, FileText, Image as ImageIcon,
  Layers, Loader2, Paperclip, Trash2, Upload, X,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type {
  ClientProject, ClientProjectFile, ClientProjectFileCategory, ClientProjectStatus,
  ClientProjectStage, ClientProjectCurrency, ProfileLite,
} from '@/types'
import type { TranslationKey } from '@/lib/i18n/translations'
import { STATUS_OPTIONS, STAGE_OPTIONS } from './constants'

type Mode = 'create' | 'edit'

interface Props {
  mode: Mode
  initial?: ClientProject
  // Full team list to populate the "responsible person" dropdown.
  profiles?: ProfileLite[]
  canEdit?: boolean
  // Separate from `canEdit` so we can let a project_manager remove the project
  // and its file attachments while a regular employee can only edit fields
  // (and only the project_manager / super_admin can wipe files).
  canDelete?: boolean
}

// XHR-backed upload so we can drive a real progress bar (fetch can't expose
// upload progress events in the browser). Returns the parsed JSON or throws.
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

interface PendingUpload {
  id: string
  name: string
  size: number
  percent: number
}

// The four buckets a file can live in. Files can be moved between buckets
// via the per-row "move to" dropdown.
const BUCKETS: ClientProjectFileCategory[] = ['boq', 'spec', 'drawing', 'other']

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const base = decodeURIComponent(path.split('/').pop() || 'file')
    return base
  } catch {
    return 'file'
  }
}

// Older rows didn't have `category`. Treat anything unknown as 'other' so
// existing data keeps showing.
function bucketOf(f: ClientProjectFile): ClientProjectFileCategory {
  return (f.category && BUCKETS.includes(f.category)) ? f.category : 'other'
}

export function ClientProjectForm({ mode, initial, profiles = [], canEdit = true, canDelete = false }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const editable = mode === 'create' || canEdit
  // When creating, "delete a not-yet-saved attachment" just removes it from
  // the local list — no permission needed for that.
  const canRemoveFiles = mode === 'create' || canDelete

  const [nameEn, setNameEn] = useState(initial?.name_en || '')
  const [nameAr, setNameAr] = useState(initial?.name_ar || '')
  const [companyEn, setCompanyEn] = useState(initial?.company_en || '')
  const [companyAr, setCompanyAr] = useState(initial?.company_ar || '')
  const [engEn, setEngEn]     = useState(initial?.engineer_name_en || '')
  const [engAr, setEngAr]     = useState(initial?.engineer_name_ar || '')
  const [engPhone, setEngPhone] = useState(initial?.engineer_phone || '')
  const [endDate, setEndDate] = useState(initial?.end_date || '')
  const [currency, setCurrency] = useState<ClientProjectCurrency>(
    (initial?.pricing_currency as ClientProjectCurrency) || 'SAR'
  )
  const [status, setStatus]   = useState<ClientProjectStatus>((initial?.status as ClientProjectStatus) || 'new')
  const [stage,  setStage]    = useState<ClientProjectStage>((initial?.stage  as ClientProjectStage)  || 'receive_quotes')
  const [keywords, setKeywords] = useState(initial?.keywords || '')
  const [notes,  setNotes]    = useState(initial?.notes || '')
  const [responsibleId, setResponsibleId] = useState<string>(initial?.responsible_user_id || '')
  const [files,  setFiles]    = useState<ClientProjectFile[]>(initial?.files || [])
  // Pending uploads keyed by bucket so each card renders its own bars.
  const [pending, setPending] = useState<Record<ClientProjectFileCategory, PendingUpload[]>>({
    boq: [], spec: [], drawing: [], other: [],
  })

  const [saving, setSaving] = useState(false)

  const filesByBucket = (b: ClientProjectFileCategory) => files.filter(f => bucketOf(f) === b)
  const boqFiles = filesByBucket('boq')
  const hasAnyPending = (Object.values(pending) as PendingUpload[][]).some(arr => arr.length > 0)

  async function handleUpload(bucket: ClientProjectFileCategory, list: FileList | File[]) {
    const items = Array.from(list)
    if (items.length === 0) return

    for (const f of items) {
      const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setPending(prev => ({
        ...prev,
        [bucket]: [...prev[bucket], { id: pendingId, name: f.name, size: f.size, percent: 0 }],
      }))
      try {
        const result = await uploadWithProgress(f, 'projects', (pct) => {
          setPending(prev => ({
            ...prev,
            [bucket]: prev[bucket].map(p => p.id === pendingId ? { ...p, percent: pct } : p),
          }))
        })
        if (!result.url) throw new Error(result.error || 'Upload failed')
        // Every bucket now accepts multiple uploads — BOQ included, since
        // the team sometimes attaches the Excel BOQ plus a photo of the
        // signed-off paper version.
        setFiles(prev => [
          ...prev,
          { url: result.url, name: f.name, key: result.key, bytes: result.bytes, category: bucket },
        ])
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

  function removeFile(file: ClientProjectFile) {
    setFiles(prev => prev.filter(f => f.url !== file.url))
  }

  function moveFile(file: ClientProjectFile, to: ClientProjectFileCategory) {
    if (bucketOf(file) === to) return
    setFiles(prev => prev.map(f => f.url === file.url ? { ...f, category: to } : f))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nameEn.trim() && !nameAr.trim()) {
      toast.error(t('cp_form_name_en'))
      return
    }
    // At least one BOQ attachment is required; specs/drawings/other are
    // optional. Multiple BOQ files are now allowed (Excel + photo, etc.).
    if (boqFiles.length === 0) {
      toast.error(t('cp_form_boq_required'))
      return
    }
    setSaving(true)
    const payload = {
      name_en: nameEn, name_ar: nameAr,
      company_en: companyEn, company_ar: companyAr,
      engineer_name_en: engEn, engineer_name_ar: engAr,
      engineer_phone: engPhone,
      end_date: endDate || null,
      pricing_currency: currency,
      status, stage, keywords, notes,
      // Empty string from the "—" option in the dropdown becomes null on
      // the server side so the FK clears cleanly.
      responsible_user_id: responsibleId || null,
      files,
    }
    const url = mode === 'create' ? '/api/client-projects' : `/api/client-projects/${initial!.id}`
    const method = mode === 'create' ? 'POST' : 'PATCH'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const j = await res.json()
    setSaving(false)
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return
    }
    toast.success(mode === 'create' ? t('cp_form_submit') : t('saved'))
    // After creating, drop the user back on the list. After editing, stay
    // on the project so they can keep tweaking without losing context.
    if (mode === 'create') router.push('/projects')
    else router.refresh()
  }

  async function handleDelete() {
    if (!initial) return
    if (!confirm(t('cp_delete_confirm'))) return
    await fetch(`/api/client-projects/${initial.id}`, { method: 'DELETE' })
    router.push('/projects')
  }

  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('cp_back')}
      </Link>

      <h1 className="text-2xl md:text-3xl font-bold mb-6">
        {mode === 'create' ? t('cp_new_project') : (isRtl ? (initial?.name_ar || initial?.name_en) : (initial?.name_en || initial?.name_ar))}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('cp_form_name_en')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('cp_form_name_en')}</Label>
                <Input value={nameEn} onChange={e => setNameEn(e.target.value)} dir="ltr" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_name_ar')}</Label>
                <Input value={nameAr} onChange={e => setNameAr(e.target.value)} dir="rtl" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_company_en')}</Label>
                <Input value={companyEn} onChange={e => setCompanyEn(e.target.value)} dir="ltr" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_company_ar')}</Label>
                <Input value={companyAr} onChange={e => setCompanyAr(e.target.value)} dir="rtl" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_engineer_en')}</Label>
                <Input value={engEn} onChange={e => setEngEn(e.target.value)} dir="ltr" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_engineer_ar')}</Label>
                <Input value={engAr} onChange={e => setEngAr(e.target.value)} dir="rtl" disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_engineer_phone')}</Label>
                {/* tel + numeric inputMode = phone keypad on mobile, accepts +,
                    spaces and digits. The setter strips anything else so the
                    field stays "numeric only". */}
                <Input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9+\s]*"
                  value={engPhone}
                  onChange={e => setEngPhone(e.target.value.replace(/[^\d+\s]/g, ''))}
                  dir="ltr"
                  disabled={!editable}
                  placeholder="+966 5XX XXX XXX"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_quote_due_date')}</Label>
                <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={!editable} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_form_currency')}</Label>
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={currency}
                  onChange={e => setCurrency(e.target.value as ClientProjectCurrency)}
                  disabled={!editable}
                >
                  <option value="SAR">{t('cp_currency_sar')}</option>
                  <option value="USD">{t('cp_currency_usd')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_col_status')}</Label>
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={status}
                  onChange={e => setStatus(e.target.value as ClientProjectStatus)}
                  disabled={!editable}
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{t(o.key as TranslationKey)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('cp_col_stage')}</Label>
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={stage}
                  onChange={e => setStage(e.target.value as ClientProjectStage)}
                  disabled={!editable}
                >
                  {STAGE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{t(o.key as TranslationKey)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t('cp_form_responsible')}</Label>
                {/* Internal owner — the person on our team who's accountable
                    for this project. Optional: "—" leaves it unassigned. */}
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={responsibleId}
                  onChange={e => setResponsibleId(e.target.value)}
                  disabled={!editable}
                >
                  <option value="">— {t('cp_form_responsible_none')} —</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name || p.email || p.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('cp_form_keywords')}</Label>
              {/* Single-language free text. Comma-separated phrases keep the
                  search index simple (the list view does a substring match). */}
              <Input
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                disabled={!editable}
                placeholder={t('cp_form_keywords_ph')}
              />
              <p className="text-[11px] text-muted-foreground">{t('cp_form_keywords_hint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t('cp_form_notes')}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} disabled={!editable} />
            </div>
          </CardContent>
        </Card>

        {/* Files — 4 buckets. BOQ is required (single), the rest are
            optional multi-file. Each row has a "move to" picker so files
            imported elsewhere (e.g. via the Furn flow) can be re-categorized. */}
        <FileBucketCard
          title={`${t('cp_form_boq')} *`}
          hint={t('cp_form_boq_hint')}
          icon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
          accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg"
          multiple
          files={boqFiles}
          pending={pending.boq}
          editable={editable}
          canRemove={canRemoveFiles}
          onFiles={(fl) => handleUpload('boq', fl)}
          onRemove={removeFile}
          onMove={moveFile}
          bucket="boq"
          t={t}
        />
        <FileBucketCard
          title={t('cp_form_specs')}
          hint={t('cp_form_specs_hint')}
          icon={<FileText className="w-4 h-4 text-blue-600" />}
          accept=".pdf,.doc,.docx"
          multiple
          files={filesByBucket('spec')}
          pending={pending.spec}
          editable={editable}
          canRemove={canRemoveFiles}
          onFiles={(fl) => handleUpload('spec', fl)}
          onRemove={removeFile}
          onMove={moveFile}
          bucket="spec"
          t={t}
        />
        <FileBucketCard
          title={t('cp_form_drawings')}
          hint={t('cp_form_drawings_hint')}
          icon={<ImageIcon className="w-4 h-4 text-purple-600" />}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          multiple
          files={filesByBucket('drawing')}
          pending={pending.drawing}
          editable={editable}
          canRemove={canRemoveFiles}
          onFiles={(fl) => handleUpload('drawing', fl)}
          onRemove={removeFile}
          onMove={moveFile}
          bucket="drawing"
          t={t}
        />
        <FileBucketCard
          title={t('cp_form_other')}
          hint={t('cp_form_other_hint')}
          icon={<Paperclip className="w-4 h-4 text-amber-600" />}
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.txt"
          multiple
          files={filesByBucket('other')}
          pending={pending.other}
          editable={editable}
          canRemove={canRemoveFiles}
          onFiles={(fl) => handleUpload('other', fl)}
          onRemove={removeFile}
          onMove={moveFile}
          bucket="other"
          t={t}
        />

        <div className="flex flex-wrap justify-between gap-3">
          {editable && (
            <Button type="submit" disabled={saving || hasAnyPending} size="lg">
              {saving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : (mode === 'create' ? t('cp_form_submit') : t('cp_form_save_changes'))}
            </Button>
          )}
          {mode === 'edit' && canDelete && (
            <Button type="button" variant="destructive" onClick={handleDelete}>
              <Trash2 className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
              {t('cp_delete_confirm').replace('?', '').replace('؟', '')}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

// ─── FileBucketCard ──────────────────────────────────────────────────────
// One card per bucket. Each row in the list shows the filename, a download
// button, a "move to" picker (to recategorize), and a remove button.
function FileBucketCard({
  title, hint, icon, accept, multiple, files, pending, editable, canRemove,
  onFiles, onRemove, onMove, bucket, t,
}: {
  title: string
  hint: string
  icon: React.ReactNode
  accept: string
  multiple: boolean
  files: ClientProjectFile[]
  pending: PendingUpload[]
  editable: boolean
  canRemove: boolean
  onFiles: (files: FileList | File[]) => void
  onRemove: (file: ClientProjectFile) => void
  onMove: (file: ClientProjectFile, to: ClientProjectFileCategory) => void
  bucket: ClientProjectFileCategory
  t: (k: TranslationKey) => string
}) {
  // BOQ slot is single — once one is uploaded, hide the upload button so
  // the user can't add a second one (they have to remove or move first).
  const fullForSingle = !multiple && files.length > 0
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {files.map(f => (
          <ClientProjectFileRow
            key={f.url}
            file={f}
            currentBucket={bucket}
            canRemove={canRemove}
            onRemove={() => onRemove(f)}
            onMove={(to) => onMove(f, to)}
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

        {editable && !fullForSingle && (
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm cursor-pointer hover:bg-muted/30 transition">
            <Upload className="w-4 h-4" />
            <span>{t('cp_form_upload')}</span>
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

function ClientProjectFileRow({
  file, currentBucket, canRemove, onRemove, onMove, t,
}: {
  file: ClientProjectFile
  currentBucket: ClientProjectFileCategory
  canRemove: boolean
  onRemove: () => void
  onMove: (to: ClientProjectFileCategory) => void
  t: (k: TranslationKey) => string
}) {
  const labelFor = (b: ClientProjectFileCategory): string =>
    b === 'boq'      ? t('cp_form_boq')
  : b === 'spec'     ? t('cp_form_specs')
  : b === 'drawing'  ? t('cp_form_drawings')
                     : t('cp_form_other')
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
        {typeof file.bytes === 'number' && file.bytes > 0 && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            ({(file.bytes / 1024 / 1024).toFixed(2)} MB)
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* "Move to" picker — disabled option is the current bucket. */}
        <label className="relative inline-flex items-center gap-1 px-2 py-1 rounded-md border bg-background text-xs cursor-pointer hover:bg-muted/40">
          <Layers className="w-3 h-3" />
          <span>{t('cp_form_move_to')}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
          <select
            value={currentBucket}
            onChange={(e) => onMove(e.target.value as ClientProjectFileCategory)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label={t('cp_form_move_to')}
          >
            {BUCKETS.map(b => (
              <option key={b} value={b} disabled={b === currentBucket}>
                {labelFor(b)}
              </option>
            ))}
          </select>
        </label>
        <a
          href={file.url}
          download={file.name || fileNameFromUrl(file.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
          title={t('cp_form_download')}
        >
          <Download className="w-4 h-4" />
        </a>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
