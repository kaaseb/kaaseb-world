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
  Pencil, KeyRound, Lock, LockOpen, ShieldCheck,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { uploadFile } from '@/lib/upload-client'
import type { ImportantDocument } from '@/types'

interface Props {
  initialDocs: ImportantDocument[]
  canManage: boolean
  isSuperAdmin?: boolean
  lockConfigured?: boolean
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

export function ImportantDocsClient({ initialDocs, canManage, isSuperAdmin = false, lockConfigured = false }: Props) {
  const { t, isRtl } = useLanguage()
  const tx = (ar: string, en: string) => (isRtl ? ar : en)
  const [docs, setDocs] = useState<ImportantDocument[]>(initialDocs)
  const [openDialog, setOpenDialog] = useState(false)

  // Edit-dialog state (edit an existing document's fields; file replace optional)
  const [editing, setEditing] = useState<ImportantDocument | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Super-admin: set / change / clear the page PIN
  const [pinPanel, setPinPanel] = useState(false)
  const [lockOn, setLockOn] = useState(lockConfigured)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  // Optional file replacement inside the edit dialog
  const [editFile, setEditFile] = useState<{ url: string; name: string; key?: string } | null>(null)
  const [editUploading, setEditUploading] = useState(false)

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
    e.target.value = '' // reset the input up front so re-picking the same file fires
    if (!f) return
    // Direct-to-S3 (via uploadFile) so a big scan bypasses the nginx size limit;
    // try/finally guarantees the spinner ALWAYS clears, even on error/timeout —
    // the old raw fetch left it spinning forever when a 413 HTML body broke json().
    setUploading(true)
    try {
      const up = await uploadFile(f, 'documents')
      setFile({ url: up.url, name: up.name, key: up.key })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشل الرفع')
    } finally {
      setUploading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { toast.error(t('doc_file')); return }
    if (!nameEn.trim() && !nameAr.trim()) { toast.error(t('doc_name_en')); return }
    setSaving(true)
    try {
      const res = await fetch('/api/important-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name_en: nameEn, name_ar: nameAr,
          file_url: file.url, file_name: file.name, file_key: file.key,
          expiry_date: expiry || null, notes,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      setDocs(prev => [j.document, ...prev])
      setOpenDialog(false)
      reset()
    } catch {
      toast.error('فشل الحفظ — تأكد من الاتصال.')
    } finally {
      setSaving(false)
    }
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

  function openEdit(d: ImportantDocument) {
    setEditing({ ...d })
    setEditFile(null)
    setEditUploading(false)
  }

  async function handleEditUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setEditUploading(true)
    try {
      const up = await uploadFile(f, 'documents')
      setEditFile({ url: up.url, name: up.name, key: up.key })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشل الرفع')
    } finally {
      setEditUploading(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.name_en?.trim() && !editing.name_ar?.trim()) { toast.error(t('doc_name_en')); return }
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {
        name_en: editing.name_en || '', name_ar: editing.name_ar || '',
        expiry_date: editing.expiry_date || null, notes: editing.notes || '',
      }
      // Only send file fields when the user actually replaced the file.
      if (editFile) { payload.file_url = editFile.url; payload.file_name = editFile.name; payload.file_key = editFile.key }
      const res = await fetch(`/api/important-documents/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      setDocs(prev => prev.map(x => (x.id === j.document.id ? j.document : x)))
      setEditing(null); setEditFile(null)
      toast.success(tx('تم الحفظ ✓', 'Saved ✓'))
    } catch {
      toast.error('فشل الحفظ — تأكد من الاتصال.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault()
    if (pinBusy) return
    if (newPin.trim().length < 4) { toast.error(tx('الرقم قصير — 4 خانات على الأقل', 'PIN too short — min 4 digits')); return }
    if (newPin.trim() !== confirmPin.trim()) { toast.error(tx('الرقمان غير متطابقين', 'PINs do not match')); return }
    setPinBusy(true)
    try {
      const res = await fetch('/api/important-documents/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin: newPin.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      setLockOn(true); setPinPanel(false); setNewPin(''); setConfirmPin('')
      toast.success(tx('تم تفعيل القفل ✓', 'Lock enabled ✓'))
    } catch {
      toast.error('فشل الحفظ')
    } finally {
      setPinBusy(false)
    }
  }

  async function clearPin() {
    if (pinBusy) return
    if (!confirm(tx('إزالة الرقم السري وفتح الصفحة للجميع؟', 'Remove the PIN and open the page for everyone?'))) return
    setPinBusy(true)
    try {
      const res = await fetch('/api/important-documents/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      setLockOn(false); setPinPanel(false); setNewPin(''); setConfirmPin('')
      toast.success(tx('تم إلغاء القفل ✓', 'Lock removed ✓'))
    } catch {
      toast.error('فشل')
    } finally {
      setPinBusy(false)
    }
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
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="lg" onClick={() => setPinPanel(v => !v)} className="gap-2">
              {lockOn ? <Lock className="w-4 h-4 text-amber-600" /> : <LockOpen className="w-4 h-4" />}
              {lockOn ? tx('الرقم السري', 'PIN') : tx('قفل بالرقم السري', 'Set PIN')}
            </Button>
          )}
          {canManage && (
            <Button onClick={() => setOpenDialog(true)} size="lg">
              <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
              {t('doc_new')}
            </Button>
          )}
        </div>
      </div>

      {isSuperAdmin && pinPanel && (
        <Card className="border shadow-sm mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              {lockOn ? tx('تغيير الرقم السري', 'Change PIN') : tx('تفعيل قفل الأوراق المهمة', 'Lock the important documents')}
            </div>
            <form onSubmit={savePin} className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)}
                placeholder={tx('رقم سري جديد', 'New PIN')} className="h-10 rounded-md border px-3 text-sm w-full sm:w-44 outline-none focus:border-amber-400" />
              <input type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)}
                placeholder={tx('تأكيد الرقم', 'Confirm PIN')} className="h-10 rounded-md border px-3 text-sm w-full sm:w-44 outline-none focus:border-amber-400" />
              <Button type="submit" disabled={pinBusy} className="gap-2">
                {pinBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                {tx('حفظ', 'Save')}
              </Button>
              {lockOn && (
                <Button type="button" variant="ghost" disabled={pinBusy} onClick={clearPin} className="gap-2 text-red-600 hover:text-red-700">
                  <LockOpen className="w-4 h-4" />{tx('إلغاء القفل', 'Remove lock')}
                </Button>
              )}
            </form>
            <p className="text-[11px] text-muted-foreground mt-2">
              {tx('يُطلب هذا الرقم من كل من يفتح صفحة الأوراق المهمة. تغييره يُخرج جميع الأجهزة الأخرى.', 'Everyone opening the important-docs page must enter this PIN. Changing it signs out all other devices.')}
            </p>
          </CardContent>
        </Card>
      )}

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
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => openEdit(d)}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-blue-50 text-blue-600 transition"
                          aria-label={tx('تعديل', 'Edit')}
                          title={tx('تعديل', 'Edit')}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(d)}
                          disabled={deleting === d.id}
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-50 text-red-600 transition"
                          aria-label={t('doc_delete_confirm')}
                        >
                          {deleting === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
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
                <Label>{t('doc_expiry')} <span className="text-muted-foreground font-normal">({tx('اختياري', 'optional')})</span></Label>
                <Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">{tx('عند تحديده يصلك تنبيه قبل الانتهاء بـ30 و7 أيام ويوم الانتهاء.', 'If set, you get alerts 30 and 7 days before, and on the expiry day.')}</p>
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

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setEditFile(null) } }}>
        <DialogContent className="max-w-2xl" dir={isRtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{tx('تعديل المستند', 'Edit document')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('doc_name_en')}</Label>
                  <Input value={editing.name_en || ''} onChange={e => setEditing({ ...editing, name_en: e.target.value })} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('doc_name_ar')}</Label>
                  <Input value={editing.name_ar || ''} onChange={e => setEditing({ ...editing, name_ar: e.target.value })} dir="rtl" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('doc_file')}</Label>
                {editFile ? (
                  <div className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="text-sm truncate">{editFile.name}</span>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditFile(null)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <a href={editing.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      <FileText className="w-4 h-4" />{editing.file_name || tx('الملف الحالي', 'Current file')}
                    </a>
                    <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm cursor-pointer hover:bg-muted/30">
                      {editUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {tx('استبدال', 'Replace')}
                      <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleEditUpload} disabled={editUploading} />
                    </label>
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('doc_expiry')}</Label>
                  <Input type="date" value={editing.expiry_date ? String(editing.expiry_date).slice(0, 10) : ''} onChange={e => setEditing({ ...editing, expiry_date: e.target.value || null })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('doc_notes')}</Label>
                <Textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={savingEdit || editUploading}>
                  {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : tx('حفظ', 'Save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
