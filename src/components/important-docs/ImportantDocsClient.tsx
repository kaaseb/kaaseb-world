'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  FileBadge, FileText, Plus, Trash2, Download, Loader2, Upload, AlertCircle, Calendar,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ImportantDocument } from '@/types'

interface Props {
  initialDocs: ImportantDocument[]
  canManage: boolean
}

// A document goes "red" a full month before it expires so the team has time to
// renew it before it lapses.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

type ExpiryState = 'none' | 'ok' | 'soon' | 'expired'

function expiryState(date: string | null): ExpiryState {
  if (!date) return 'none'
  const t = new Date(date).getTime()
  const now = Date.now()
  if (t < now) return 'expired'
  if (t - now <= THIRTY_DAYS_MS) return 'soon'
  return 'ok'
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

export function ImportantDocsClient({ initialDocs, canManage }: Props) {
  const { t, isRtl } = useLanguage()
  const [docs, setDocs] = useState<ImportantDocument[]>(initialDocs)
  const [openDialog, setOpenDialog] = useState(false)

  // Create-dialog state
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [expiry, setExpiry] = useState('')
  const [notes,  setNotes]  = useState('')
  const [file,   setFile]   = useState<{ url: string; name: string; key?: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState<string | null>(null)

  // Highlight expiring/expired docs at the top, then by name.
  const sorted = useMemo(() => {
    const priority: Record<ExpiryState, number> = { expired: 0, soon: 1, ok: 2, none: 3 }
    return [...docs].sort((a, b) => {
      const ea = priority[expiryState(a.expiry_date)]
      const eb = priority[expiryState(b.expiry_date)]
      if (ea !== eb) return ea - eb
      return (a.name_en || a.name_ar || '').localeCompare(b.name_en || b.name_ar || '')
    })
  }, [docs])

  function reset() {
    setNameEn(''); setNameAr(''); setExpiry(''); setNotes(''); setFile(null)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', f)
    fd.append('kind', 'documents')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json()
    setUploading(false)
    e.target.value = ''
    if (!j.url) {
      toast.error(j.error || 'Upload failed')
      return
    }
    setFile({ url: j.url, name: f.name, key: j.key })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { toast.error(t('doc_file')); return }
    if (!nameEn.trim() && !nameAr.trim()) { toast.error(t('doc_name_en')); return }
    setSaving(true)
    const res = await fetch('/api/important-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name_en: nameEn, name_ar: nameAr,
        file_url: file.url, file_name: file.name, file_key: file.key,
        expiry_date: expiry || null, notes,
      }),
    })
    const j = await res.json()
    setSaving(false)
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return
    }
    setDocs(prev => [j.document, ...prev])
    setOpenDialog(false)
    reset()
  }

  async function handleDelete(d: ImportantDocument) {
    if (!confirm(t('doc_delete_confirm'))) return
    setDeleting(d.id)
    const res = await fetch(`/api/important-documents/${d.id}`, { method: 'DELETE' })
    setDeleting(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Failed')
      return
    }
    setDocs(prev => prev.filter(x => x.id !== d.id))
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-rose-600 text-white flex items-center justify-center shadow-md">
            <FileBadge className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t('doc_title')}</h1>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setOpenDialog(true)} size="lg">
            <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
            {t('doc_new')}
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center text-muted-foreground">
            <FileBadge className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
            <p>{t('doc_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        // Card grid — expiring/expired float to the top (the `sorted` order),
        // and a red left border makes at-risk documents jump out at a glance.
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(d => {
            const state = expiryState(d.expiry_date)
            const accent =
              state === 'expired' ? 'border-s-4 border-s-red-800'
              : state === 'soon' ? 'border-s-4 border-s-red-600'
              : 'border-s-4 border-s-transparent'
            return (
              <Card key={d.id} className={`shadow-sm hover:shadow-md transition ${accent}`}>
                <CardContent className="p-4 flex flex-col gap-3 h-full">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold leading-snug break-words">{display(d.name_en, d.name_ar, isRtl)}</p>
                      {d.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.notes}</p>}
                    </div>
                    {canManage && (
                      <button
                        onClick={() => handleDelete(d)}
                        disabled={deleting === d.id}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-50 text-red-600 transition flex-shrink-0"
                        aria-label={t('doc_delete_confirm')}
                      >
                        {deleting === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>

                  <div className="mt-auto space-y-2">
                    {d.expiry_date ? (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                          <Calendar className="w-3 h-3" />
                          {new Date(d.expiry_date).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB')}
                        </span>
                        {state === 'soon' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">
                            <AlertCircle className="w-3 h-3" />{t('doc_badge_expiring')}
                          </span>
                        )}
                        {state === 'expired' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-800 text-white">
                            <AlertCircle className="w-3 h-3" />{t('doc_badge_expired')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">{isRtl ? 'بدون تاريخ انتهاء' : 'No expiry date'}</span>
                    )}
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 h-9 rounded-md text-sm font-medium border hover:bg-muted transition"
                    >
                      <Download className="w-4 h-4" />
                      {t('doc_download')}
                    </a>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={openDialog} onOpenChange={(o) => { setOpenDialog(o); if (!o) reset() }}>
        <DialogContent className="max-w-2xl" dir={isRtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{t('doc_new')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('doc_name_en')}</Label>
                <Input value={nameEn} onChange={e => setNameEn(e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('doc_name_ar')}</Label>
                <Input value={nameAr} onChange={e => setNameAr(e.target.value)} dir="rtl" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('doc_file')} *</Label>
              {file ? (
                <div className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <span className="text-sm truncate">{file.name}</span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setFile(null)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/30 transition">
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : <Upload className="w-5 h-5 text-muted-foreground" />}
                  <span className="text-sm text-muted-foreground">PDF / Image</span>
                  <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('doc_expiry')}</Label>
                <Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('doc_notes')}</Label>
              <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving || !file}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('doc_new')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
