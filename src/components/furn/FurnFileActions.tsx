'use client'

// File actions on an EXISTING Furn project (files tab):
//
//   1. "Links in the email" — every file link the imported notes carry, each
//      with «جلب»: the server resolves the platform (WeTransfer, Google Drive
//      file/folder, Dropbox, OneDrive, SharePoint-when-public, GoFile,
//      MediaFire, direct files), opens ZIP/RAR, and files everything into the
//      right bucket by name (Excel → BOQ, PDF → specs, DWG/images → drawings).
//      A link that needs a person (Microsoft sign-in, password, expired) shows
//      the reason under the link with «افتح الرابط».
//   2. "Any link" box — paste a link the email didn't carry.
//   3. "Add files" per bucket — upload from the computer straight onto this
//      project (no new project, same workflow), then press «إعادة المحاولة».
//
// Server side: POST /api/furn/projects/[id]/fetch-links and …/files, which
// also move the email-body ".txt" placeholder out of the BOQ bucket once real
// BOQs arrive.

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Download, ExternalLink, Link2, Loader2, LockKeyhole, Upload, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { uploadFile } from '@/lib/upload-client'
import { discoverFileLinks, isEmailBodyPlaceholder, type DiscoveredLink } from '@/lib/links/discover'
import type { FurnProject } from '@/types'

type Bucket = 'boq' | 'spec' | 'drawing' | 'other'
type FileRef = { url: string; name: string }

/** Persisted outcome of the last fetch on a link (S3 extras) — mirrors the server type. */
export interface LinkFetch {
  at: string
  status: 'files' | 'needsLogin' | 'password' | 'expired' | 'notFound' | 'page' | 'unsupported'
  provider: string
  files: number
  message?: string
}

interface Props {
  project: FurnProject
  notes: string | null
  boqFiles: FileRef[]
  /** url → last fetch outcome, from the server; survives navigation. */
  fetched: Record<string, LinkFetch>
  isRtl: boolean
  disabled?: boolean
  /** Server answer after attaching: the fresh project row + the full BOQ list (+ outcomes). */
  onAttached: (project: FurnProject, boqFiles: FileRef[], linkFetches?: Record<string, LinkFetch>) => void
  /** A refused link (sign-in / password / expired) was recorded server-side. */
  onFetchRecorded: (linkFetches: Record<string, LinkFetch>) => void
}

const BUCKET_LABEL: Record<Bucket, { ar: string; en: string }> = {
  boq: { ar: 'BOQ', en: 'BOQ' },
  spec: { ar: 'مواصفات', en: 'Specs' },
  drawing: { ar: 'رسومات', en: 'Drawings' },
  other: { ar: 'أخرى', en: 'Other' },
}

function summary(added: Record<Bucket, number>, demoted: number, isRtl: boolean): string {
  const parts = (Object.keys(BUCKET_LABEL) as Bucket[]).filter((b) => added[b] > 0).map((b) => `${isRtl ? BUCKET_LABEL[b].ar : BUCKET_LABEL[b].en} ${added[b]}`)
  const base = parts.length ? parts.join(' · ') : (isRtl ? 'لا جديد (الملفات موجودة مسبقاً)' : 'nothing new (already attached)')
  const demote = demoted ? (isRtl ? ' — ونُقل نص الإيميل إلى «أخرى»' : ' — email text moved to “Other”') : ''
  return `${base}${demote}`
}

function when(iso: string, isRtl: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(isRtl ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function FurnFileActions({ project, notes, boqFiles, fetched, isRtl, disabled, onAttached, onFetchRecorded }: Props) {
  const links = useMemo(() => discoverFileLinks(notes), [notes])
  const [busy, setBusy] = useState<string | null>(null) // link url or bucket being worked
  // Transient detail for THIS session's fetch (bucket breakdown, notices); the
  // durable "fetched N files at …" comes from `fetched` (server, S3).
  const [detail, setDetail] = useState<Record<string, string>>({})
  const [manualUrl, setManualUrl] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [pickBucket, setPickBucket] = useState<Bucket>('boq')

  // The only "BOQ" is the email text → the real bill is elsewhere (the links).
  const onlyPlaceholderBoq = boqFiles.length > 0 && boqFiles.every((f) => isEmailBodyPlaceholder(f.name))

  async function fetchLink(url: string) {
    if (busy) return
    setBusy(url)
    try {
      const res = await fetch(`/api/furn/projects/${project.id}/fetch-links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { const text = j.error || (isRtl ? 'تعذّر جلب الرابط' : 'Could not fetch the link'); setDetail((o) => ({ ...o, [url]: text })); toast.error(text, { duration: 10000 }); return }
      if (j.status !== 'files') {
        const text = j.message || (isRtl ? 'تعذّر جلب الرابط' : 'Could not fetch the link')
        if (j.linkFetches) onFetchRecorded(j.linkFetches)
        else setDetail((o) => ({ ...o, [url]: text }))
        toast.error(text, { duration: 12000 })
        return
      }
      onAttached(j.project as FurnProject, (j.boqFiles || []) as FileRef[], j.linkFetches)
      const text = `${summary(j.added, j.demoted, isRtl)}${j.notices?.length ? ` — ${j.notices.slice(0, 3).join(' · ')}` : ''}`
      setDetail((o) => ({ ...o, [url]: text }))
      toast.success(`${isRtl ? `تم جلب ${j.files.length} ملف من ${j.provider}: ` : `Fetched ${j.files.length} file(s) from ${j.provider}: `}${text}. ${isRtl ? 'اضغط «إعادة المحاولة» للقراءة.' : 'Press “Retry” to read.'}`, { duration: 12000 })
      setManualUrl('')
    } catch (e) {
      const text = e instanceof Error ? e.message : (isRtl ? 'تعذّر جلب الرابط' : 'Could not fetch the link')
      setDetail((o) => ({ ...o, [url]: text }))
      toast.error(text)
    } finally {
      setBusy(null)
    }
  }

  function openPicker(bucket: Bucket) {
    if (busy) return
    setPickBucket(bucket)
    fileInput.current?.click()
  }

  async function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || [])
    e.target.value = ''
    if (list.length === 0 || busy) return
    setBusy(pickBucket)
    try {
      const uploaded: FileRef[] = []
      const failed: string[] = []
      for (const f of list) {
        try {
          const up = await uploadFile(f, 'furn')
          uploaded.push({ url: up.url, name: up.name })
        } catch (err) {
          failed.push(`${f.name}: ${err instanceof Error ? err.message : ''}`)
        }
      }
      if (uploaded.length > 0) {
        const res = await fetch(`/api/furn/projects/${project.id}/files`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: pickBucket, files: uploaded }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.project) throw new Error(j.error || (isRtl ? 'فشل الإضافة' : 'Attach failed'))
        onAttached(j.project as FurnProject, (j.boqFiles || []) as FileRef[])
        toast.success(isRtl
          ? `أُضيف ${j.added} ملف إلى ${BUCKET_LABEL[pickBucket].ar}${j.demoted ? ' — ونُقل نص الإيميل إلى «أخرى»' : ''}. اضغط «إعادة المحاولة» لقراءتها.`
          : `Added ${j.added} file(s) to ${BUCKET_LABEL[pickBucket].en}${j.demoted ? ' — email text moved to “Other”' : ''}. Press “Retry” to read them.`)
      }
      if (failed.length > 0) toast.error(failed.join('\n'), { duration: 12000 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (isRtl ? 'فشل الرفع' : 'Upload failed'))
    } finally {
      setBusy(null)
    }
  }

  /** One line under a link: durable server outcome first, this session's detail after. */
  const Outcome = ({ url }: { url: string }) => {
    const f = fetched[url]
    const d = detail[url]
    if (!f && !d) return null
    const ok = f ? f.status === 'files' : false
    const head = f
      ? ok
        ? (isRtl ? `تم الجلب — ${f.files} ملف من ${f.provider} · ${when(f.at, isRtl)}` : `Fetched — ${f.files} file(s) from ${f.provider} · ${when(f.at, isRtl)}`)
        : `${f.message || (isRtl ? 'تعذّر الجلب' : 'Could not fetch')} · ${when(f.at, isRtl)}`
      : d
    return (
      <p className={`text-[12px] flex items-start gap-1 ${ok ? 'text-emerald-700' : 'text-amber-800'}`}>
        {ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        <span>
          {head}
          {ok && d ? ` — ${d}` : ''}
          {!ok && (isRtl ? ' — بعد التحميل استخدم «أضف ملفات» أدناه.' : ' — after downloading use “Add files” below.')}
        </span>
      </p>
    )
  }

  const LinkRow = ({ l }: { l: DiscoveredLink }) => {
    const f = fetched[l.url]
    const done = f?.status === 'files'
    return (
      <div className={`p-2 rounded border text-sm space-y-1 ${done ? 'bg-emerald-50/60 border-emerald-200' : 'bg-muted/30'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate flex-1 min-w-0 flex items-center gap-1.5" title={l.url}>
            {done && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {l.label}
            <span className="text-[11px] text-muted-foreground">({l.kind})</span>
          </span>
          <Button size="sm" variant={done ? 'ghost' : 'outline'} className="gap-1 h-7" disabled={disabled || !!busy} onClick={() => fetchLink(l.url)}>
            {busy === l.url ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : done ? <RefreshCw className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            {done ? (isRtl ? 'جلب مرة أخرى' : 'Fetch again') : f ? (isRtl ? 'حاول مجدداً' : 'Try again') : (isRtl ? 'جلب' : 'Fetch')}
          </Button>
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">
            <ExternalLink className="w-3.5 h-3.5" />{isRtl ? 'افتح الرابط' : 'Open'}
          </a>
        </div>
        {(f || detail[l.url]) ? <Outcome url={l.url} /> : l.likelyLogin ? (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <LockKeyhole className="w-3 h-3" />
            {isRtl ? 'روابط SharePoint غالباً تطلب تسجيل دخول مايكروسوفت — جرّب «جلب»؛ إن رُفض، افتحه وحمّل ثم «أضف ملفات».' : 'SharePoint links usually need a Microsoft sign-in — try “Fetch”; if refused, open, download, then “Add files”.'}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {onlyPlaceholderBoq && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
          {isRtl
            ? 'ملف الـBOQ الحالي هو نص الإيميل فقط — البنود الحقيقية ليست هنا. اضغط «جلب» على روابط الإيميل أدناه (أو أضف الملفات يدوياً) ثم «إعادة المحاولة».'
            : 'The current BOQ file is only the email text — the real items are not here. Press “Fetch” on the email links below (or add the files manually), then “Retry”.'}
        </div>
      )}

      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Link2 className="w-4 h-4 text-sky-600" />
          {links.length > 0
            ? (isRtl ? `روابط الملفات في الإيميل (${links.length})` : `File links in the email (${links.length})`)
            : (isRtl ? 'جلب من رابط' : 'Fetch from a link')}
          {links.length > 0 && (() => { const n = links.filter((l) => fetched[l.url]?.status === 'files').length; return n > 0 ? (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${n === links.length ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {isRtl ? `تم جلب ${n} من ${links.length}` : `${n} of ${links.length} fetched`}
            </span>) : null })()}
        </p>
        {links.length > 0 && (
          <div className="space-y-1.5">
            {links.map((l) => <LinkRow key={l.url} l={l} />)}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Input dir="ltr" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (manualUrl.trim()) fetchLink(manualUrl.trim()) } }}
            placeholder="https://we.tl/…  ·  drive.google.com/…  ·  dropbox.com/…  ·  sharepoint.com/…"
            className="flex-1 h-8 text-sm" disabled={disabled || !!busy} />
          <Button size="sm" variant="outline" className="gap-1 h-8" disabled={disabled || !!busy || !manualUrl.trim()} onClick={() => fetchLink(manualUrl.trim())}>
            {busy === manualUrl.trim() && manualUrl.trim() ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {isRtl ? 'جلب' : 'Fetch'}
          </Button>
        </div>
        {/* Links fetched by hand (not in the email) stay listed with their outcome. */}
        {Object.entries(fetched).filter(([u]) => !links.some((l) => l.url === u)).map(([u]) => (
          <div key={u} className="p-2 rounded border bg-muted/30 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate flex-1 min-w-0 text-xs" dir="ltr" title={u}>{u}</span>
              <Button size="sm" variant="ghost" className="gap-1 h-7" disabled={disabled || !!busy} onClick={() => fetchLink(u)}>
                {busy === u ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {isRtl ? 'جلب مرة أخرى' : 'Fetch again'}
              </Button>
              <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline"><ExternalLink className="w-3.5 h-3.5" />{isRtl ? 'افتح الرابط' : 'Open'}</a>
            </div>
            <Outcome url={u} />
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">
          {isRtl ? 'يفتح ZIP/RAR تلقائياً ويوزّع الملفات: إكسل → BOQ، PDF → مواصفات، DWG/صور → رسومات.' : 'Opens ZIP/RAR automatically and files them: Excel → BOQ, PDF → specs, DWG/images → drawings.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground flex items-center gap-1"><Upload className="w-3.5 h-3.5" />{isRtl ? 'أضف ملفات من الجهاز إلى:' : 'Add files from this device to:'}</span>
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
          <Button key={b} size="sm" variant={b === 'boq' ? 'default' : 'outline'} className="h-7 gap-1" disabled={disabled || !!busy} onClick={() => openPicker(b)}>
            {busy === b ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isRtl ? BUCKET_LABEL[b].ar : BUCKET_LABEL[b].en}
          </Button>
        ))}
        <input ref={fileInput} type="file" multiple className="hidden" onChange={onPicked}
          accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.dwg,.dxf,.png,.jpg,.jpeg,.webp,.zip,.rar" />
      </div>
    </div>
  )
}
