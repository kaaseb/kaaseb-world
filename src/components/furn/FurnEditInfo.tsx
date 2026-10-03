'use client'

// Edit a Furn project's client data BEFORE the quotation goes out: project,
// company and engineer — each in Arabic and English — plus the engineer's phone.
//
// The Arabic quotation prints the Arabic column, the English one the English
// column. A blank English field falls back to the Arabic value (and the dialog
// says so), so nothing ever prints empty.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Loader2, Pencil, AlertTriangle } from 'lucide-react'
import type { FurnProject } from '@/types'

interface Names { project: { ar: string; en: string }; company: { ar: string; en: string }; engineer: { ar: string; en: string } }
type Form = { project_ar: string; project_en: string; company_ar: string; company_en: string; engineer_ar: string; engineer_en: string; engineer_phone: string }

const hasArabic = (v: string) => /[؀-ۿ]/.test(v)

export function FurnEditInfo({ projectId, isRtl, onSaved }: {
  projectId: string
  isRtl: boolean
  onSaved: (project: FurnProject) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState<Form | null>(null)
  const tx = (a: string, e: string) => (isRtl ? a : e)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    fetch(`/api/furn/projects/${projectId}/names`)
      .then((r) => r.json())
      .then((j: { names?: Names; engineer_phone?: string; error?: string }) => {
        if (!alive) return
        if (!j.names) { toast.error(j.error || tx('تعذّر التحميل', 'Could not load')); setOpen(false); return }
        const n = j.names
        // A value that is really the other language is shown where it belongs,
        // so the empty column is obvious and nobody "translates" by accident.
        const own = (v: { ar: string; en: string }) => ({
          ar: hasArabic(v.ar) ? v.ar : '',
          en: v.en && !hasArabic(v.en) ? v.en : '',
          any: v.ar || v.en,
        })
        const p = own(n.project), c = own(n.company), e = own(n.engineer)
        setF({
          project_ar: p.ar || (p.en ? '' : p.any), project_en: p.en,
          company_ar: c.ar || (c.en ? '' : c.any), company_en: c.en,
          engineer_ar: e.ar || (e.en ? '' : e.any), engineer_en: e.en,
          engineer_phone: j.engineer_phone || '',
        })
      })
      .catch(() => { if (alive) { toast.error(tx('تعذّر التحميل', 'Could not load')); setOpen(false) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  async function save() {
    if (!f || saving) return
    if (!f.project_ar.trim() && !f.project_en.trim()) { toast.error(tx('اسم المشروع مطلوب', 'Project name is required')); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/furn/projects/${projectId}/names`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.project) { toast.error(j.error || tx('فشل الحفظ', 'Save failed')); return }
      onSaved(j.project as FurnProject)
      toast.success(tx('تم حفظ بيانات المشروع — ستظهر في العرض القادم', 'Project details saved — used in the next quotation'))
      setOpen(false)
    } catch {
      toast.error(tx('فشل الحفظ', 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const row = (label: string, ar: keyof Form, en: keyof Form) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Input dir="rtl" value={f![ar]} onChange={(e) => setF((s) => ({ ...s!, [ar]: e.target.value }))} placeholder={tx('بالعربي', 'Arabic')} />
        <Input dir="ltr" value={f![en]} onChange={(e) => setF((s) => ({ ...s!, [en]: e.target.value }))} placeholder="English" />
      </div>
    </div>
  )
  const missingEn = !!f && ([['project_ar', 'project_en'], ['company_ar', 'company_en'], ['engineer_ar', 'engineer_en']] as const)
    .some(([a, e]) => f[a].trim() && !f[e].trim())

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Pencil className="w-3.5 h-3.5" />{tx('تعديل بيانات المشروع', 'Edit project details')}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o) }}>
        <DialogContent className="max-w-xl" dir={isRtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{tx('بيانات المشروع في العرض السعري', 'Project details on the quotation')}</DialogTitle>
          </DialogHeader>
          {loading || !f ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {tx('العرض العربي يطبع العمود العربي، والعرض الإنجليزي يطبع العمود الإنجليزي.', 'The Arabic quotation prints the Arabic column; the English one prints the English column.')}
              </p>
              {row(tx('اسم المشروع', 'Project name'), 'project_ar', 'project_en')}
              {row(tx('الشركة', 'Company'), 'company_ar', 'company_en')}
              {row(tx('المهندس / جهة الاتصال', 'Engineer / contact'), 'engineer_ar', 'engineer_en')}
              <div className="space-y-1">
                <Label className="text-xs">{tx('جوال المهندس', 'Engineer phone')}</Label>
                <Input dir="ltr" value={f.engineer_phone} onChange={(e) => setF((s) => ({ ...s!, engineer_phone: e.target.value }))} className="sm:w-1/2" />
              </div>
              {missingEn && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {tx('حقل إنجليزي فارغ: العرض الإنجليزي سيطبع القيمة العربية مكانه. اكتب الاسم بالإنجليزي ليظهر صحيحاً.', 'An English field is empty: the English quotation will print the Arabic value there. Type the English name to fix it.')}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>{tx('إلغاء', 'Cancel')}</Button>
            <Button onClick={save} disabled={saving || loading || !f} className="gap-1.5">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{tx('حفظ', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
