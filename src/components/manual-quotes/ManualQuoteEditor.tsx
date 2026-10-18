'use client'

// عرض يدوي — the editor. Client details, the items as a spreadsheet-style grid
// (ManualQuoteGrid: + between rows/columns, management-only columns, an image
// per row, Excel paste), file upload by drag & drop (our template lands
// field-for-field; any BOQ is mapped), export back to the Excel template,
// duplicate, delivery, VAT, T&C, live totals. Autosaves.

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, Save, Printer, UploadCloud, FileDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAutosave } from '@/hooks/useAutosave'
import { AutosaveBadge } from '@/components/ui/autosave-badge'
import { uploadFile } from '@/lib/upload-client'
import type { ManualQuote } from '@/lib/manual-quotes/store'
import { normalizeLayout } from '@/lib/manual-quotes/layout'
import type { ImportResult } from '@/lib/manual-quotes/import'
import { QuoteTermsControl, type QuoteTermsHandle } from '@/components/quote-terms/QuoteTermsControl'
import { computeTotals } from '@/lib/quotation/totals'
import { ManualQuoteGrid } from './ManualQuoteGrid'
import { ManualQuoteUpload } from './ManualQuoteUpload'
import { DuplicateQuoteButton } from './DuplicateQuoteDialog'

export function ManualQuoteEditor({ initial }: { initial: ManualQuote }) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const Back = isRtl ? ArrowRight : ArrowLeft

  const [q, setQ] = useState<ManualQuote>(() => ({
    ...initial,
    columns: initial.columns || [],
    layout: normalizeLayout(initial.layout, initial.columns || []),
    hidden: initial.hidden || [],
  }))
  const [saving, setSaving] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  // Terms & Conditions control — flushed before save/print so an unsaved edit
  // can never miss the PDF.
  const termsRef = useRef<QuoteTermsHandle>(null)

  function set<K extends keyof ManualQuote>(k: K, v: ManualQuote[K]) { setQ((s) => ({ ...s, [k]: v })) }

  // ONE persist function for the autosave and the Save button.
  const persist = useCallback(async (value: ManualQuote, ctx: { leaving: boolean }) => {
    const body = JSON.stringify(value)
    const res = await fetch(`/api/manual-quotes/${value.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      // keepalive survives the tab closing; browsers cap it at 64KB of body.
      keepalive: ctx.leaving && body.length < 60_000,
      body,
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || 'فشل الحفظ')
    }
  }, [])
  // Autosave ~1.5 s after the last edit; leaving the tab flushes at once.
  const autosave = useAutosave(q, persist, { delayMs: 1500 })

  async function save(thenPrint = false) {
    setSaving(true)
    try {
      // Terms first: the print page reads the SAVED override.
      const termsOk = await termsRef.current?.flush()
      await autosave.flush(true)
      if (termsOk === false) {
        toast.error(ar ? 'لم تُحفظ الشروط والأحكام — لم تُفتح الطباعة.' : 'Terms were not saved — printing was cancelled.', { duration: 12000 })
        return
      }
      toast.success(ar ? 'تم الحفظ ✓' : 'Saved ✓')
      if (thenPrint) window.open(`/print/manual-quote/${q.id}`, '_blank')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'فشل الحفظ') } finally { setSaving(false) }
  }

  async function exportExcel() {
    try {
      await autosave.flush()
      window.location.href = `/api/manual-quotes/${q.id}/template`
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (ar ? 'احفظ أولاً' : 'Save first'))
    }
  }

  function applyImport(r: ImportResult, mode: 'replace' | 'append') {
    setQ((s) => {
      const info = r.info
      const withInfo: ManualQuote = {
        ...s,
        ...(info.project_name !== undefined ? { project_name: info.project_name } : {}),
        ...(info.company !== undefined ? { company: info.company } : {}),
        ...(info.client_name !== undefined ? { client_name: info.client_name } : {}),
        ...(info.email !== undefined ? { email: info.email } : {}),
        ...(info.phone !== undefined ? { phone: info.phone } : {}),
        ...(info.subject !== undefined ? { subject: info.subject } : {}),
        ...(info.language ? { language: info.language } : {}),
        ...(info.currency ? { currency: info.currency } : {}),
        ...(info.vat_rate !== undefined ? { vat_rate: info.vat_rate } : {}),
        ...(info.delivery ? { delivery: info.delivery } : {}),
        ...(info.shipping !== undefined ? { shipping: info.shipping } : {}),
      }
      if (mode === 'replace') {
        return { ...withInfo, columns: r.columns, layout: normalizeLayout(r.layout, r.columns), hidden: [], items: r.items }
      }
      // Append: same-named columns are shared, new ones are added.
      const byName = new Map(s.columns.map((c) => [c.name.trim().toLowerCase(), c.id]))
      const remap = new Map<string, string>()
      const columns = s.columns.slice()
      for (const c of r.columns) {
        const hit = byName.get(c.name.trim().toLowerCase())
        if (hit) remap.set(c.id, hit)
        else { columns.push(c); remap.set(c.id, c.id) }
      }
      const items = r.items.map((it) => {
        const custom: Record<string, string> = {}
        for (const [k, v] of Object.entries(it.custom || {})) { const t = remap.get(k); if (t) custom[t] = v }
        return { ...it, custom }
      })
      return { ...withInfo, columns, layout: normalizeLayout(s.layout, columns), items: [...s.items, ...items] }
    })
  }

  const uploadImage = useCallback(async (file: File) => (await uploadFile(file, 'furn')).url, [])

  const shipping = q.delivery === 'excluded' ? Math.max(0, Number(q.shipping) || 0) : 0
  // ONE totals function for every surface — the screen, the stored quote and
  // the PDF can no longer disagree by a cent.
  const { subtotal, vat, total } = computeTotals(q.items, shipping, q.vat_rate || 0)
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const toggle = 'inline-flex rounded-lg border p-0.5 text-xs'
  const opt = (on: boolean) => `px-3 py-1 rounded-md ${on ? 'bg-teal-600 text-white' : 'text-muted-foreground'}`

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <button onClick={() => router.push('/manual-quotes')} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <Back className="w-4 h-4" /> {ar ? 'العروض اليدوية' : 'Manual quotes'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">{ar ? 'عرض سعر' : 'Quotation'} <span className="text-teal-600">#{q.number}</span></h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className={toggle}>
            {(['ar', 'en'] as const).map((l) => <button key={l} onClick={() => set('language', l)} className={opt(q.language === l)}>{l === 'ar' ? 'عربي' : 'EN'}</button>)}
          </div>
          <div className={toggle}>
            {(['SAR', 'USD'] as const).map((c) => <button key={c} onClick={() => set('currency', c)} className={opt(q.currency === c)}>{c}</button>)}
          </div>
          <div className={toggle}>
            <button onClick={() => set('vat_rate', 0.15)} className={opt((q.vat_rate || 0) > 0)}>{ar ? 'ضريبة 15%' : 'VAT 15%'}</button>
            <button onClick={() => set('vat_rate', 0)} className={opt((q.vat_rate || 0) === 0)}>{ar ? 'بدون ضريبة' : 'No VAT'}</button>
          </div>
          <DuplicateQuoteButton quoteId={q.id} number={q.number} subject={q.subject || q.project_name || ''} ar={ar} beforeCopy={() => autosave.flush()} />
        </div>
      </div>

      <Card className="mb-4"><CardHeader><CardTitle className="text-base">{ar ? 'بيانات العميل' : 'Client'}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div className="space-y-1"><Label>{ar ? 'اسم المشروع' : 'Project name'}</Label><Input value={q.project_name ?? ''} onChange={(e) => set('project_name', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الشركة' : 'Company'}</Label><Input value={q.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'اسم المهندس / العميل' : 'Contact name'}</Label><Input value={q.client_name} onChange={(e) => set('client_name', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الإيميل' : 'Email'}</Label><Input dir="ltr" value={q.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الجوال' : 'Phone'}</Label><Input dir="ltr" value={q.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الموضوع' : 'Subject'}</Label><Input value={q.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder={ar ? 'مثال: توريد رخام لمشروع الفلل' : 'e.g. Marble supply for the villas'} /></div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{ar ? 'البنود' : 'Items'} <span className="text-xs font-normal text-muted-foreground">({q.items.length})</span></CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5"><UploadCloud className="w-4 h-4" />{ar ? 'رفع ملف' : 'Upload file'}</Button>
            <Button size="sm" variant="outline" onClick={exportExcel} className="gap-1.5" title={ar ? 'نزّل العرض كملف إكسل (قالب كاسب) لتكمل عليه وترفعه' : 'Download this quote as the KAASEB Excel template'}>
              <FileDown className="w-4 h-4" />{ar ? 'تنزيل كإكسل' : 'Export to Excel'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ManualQuoteGrid
            quote={q}
            ar={ar}
            onChange={(patch) => setQ((s) => ({ ...s, ...patch }))}
            uploadImage={uploadImage}
          />
        </CardContent>
      </Card>

      <Card className="mb-4"><CardContent className="p-4 space-y-2">
        <div className="space-y-1"><Label>{ar ? 'ملاحظات' : 'Notes'}</Label><Textarea rows={2} value={q.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        <div className="space-y-1 pt-1">
          <Label>{ar ? 'التوصيل' : 'Delivery'}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className={toggle}>
              {([['none', ar ? 'بدون ذكر' : 'None'], ['included', ar ? 'شامل التوصيل' : 'Included'], ['excluded', ar ? 'غير شامل' : 'Not included']] as const).map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => set('delivery', val)} className={opt(q.delivery === val)}>{lbl}</button>
              ))}
            </div>
            {q.delivery === 'excluded' && (
              <div className="flex items-center gap-1.5">
                <Input type="number" min={0} step="0.01" value={q.shipping || ''} onChange={(e) => set('shipping', Math.max(0, Number(e.target.value) || 0))}
                  className="w-36" placeholder={ar ? 'قيمة التوصيل' : 'Delivery amount'} />
                <span className="text-xs text-muted-foreground">{q.currency}</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {q.delivery === 'included' ? (ar ? 'تُطبع عبارة «الأسعار شاملة التوصيل».' : 'Prints “Prices include delivery”.')
              : q.delivery === 'excluded' ? (ar ? 'يُضاف سطر «التوصيل» بالقيمة أعلاه ويدخل ضمن الإجمالي.' : 'Adds a “Delivery” line with the amount above.')
              : (ar ? 'لا يُذكر التوصيل في العرض.' : 'Delivery not mentioned.')}
          </p>
        </div>
        {/* Terms & Conditions question sits directly under the delivery choice (owner's spec). */}
        <QuoteTermsControl ref={termsRef} scopeKey={`manual:${q.id}`} uiAr={ar} quoteLang={q.language} />
        <div className="flex flex-col items-end gap-1 text-sm pt-2 border-t">
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'المجموع' : 'Subtotal'}</span><span className="tabular-nums w-28 text-end">{money(subtotal)}</span></div>
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'الضريبة' : 'VAT'} {((q.vat_rate || 0) * 100).toFixed(0)}%</span><span className="tabular-nums w-28 text-end">{money(vat)}</span></div>
          <div className="flex gap-8 font-bold text-base"><span>{ar ? 'الإجمالي' : 'Total'}</span><span className="tabular-nums w-28 text-end">{money(total)} {q.currency}</span></div>
        </div>
      </CardContent></Card>

      <div className="flex items-center gap-2 flex-wrap">
        <AutosaveBadge a={autosave} ar={ar} />
        <Button onClick={() => save(false)} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
        </Button>
        <Button variant="outline" onClick={() => save(true)} disabled={saving} className="gap-2">
          <Printer className="w-4 h-4" />{ar ? 'حفظ وطباعة/PDF' : 'Save & Print/PDF'}
        </Button>
      </div>

      <ManualQuoteUpload
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        ar={ar}
        lang={q.language}
        hasContent={q.items.length > 0}
        onImport={applyImport}
      />
    </div>
  )
}
