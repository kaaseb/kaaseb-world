'use client'

// عرض يدوي — the editor. Client details + priced line items (each with an
// optional thumbnail uploaded straight to S3) + live totals. Saves the whole
// quote to S3 via PATCH.

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Plus, Trash2, Loader2, Save, Printer, ImagePlus, ClipboardPaste, X, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/contexts/LanguageContext'
import { uploadFile } from '@/lib/upload-client'
import type { ManualQuote, ManualQuoteItem, ManualQuoteColumn } from '@/lib/manual-quotes/store'
import { ExcelPasteDialog } from './ExcelPasteDialog'
import { QuoteTermsControl } from '@/components/quote-terms/QuoteTermsControl'

function rid() { return `${Math.random().toString(36).slice(2, 10)}` }

export function ManualQuoteEditor({ initial }: { initial: ManualQuote }) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const Back = isRtl ? ArrowRight : ArrowLeft

  const [q, setQ] = useState<ManualQuote>(initial)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [boqLoading, setBoqLoading] = useState(false)

  const cols = q.columns || []

  function set<K extends keyof ManualQuote>(k: K, v: ManualQuote[K]) { setQ((s) => ({ ...s, [k]: v })) }
  function setItem(id: string, patch: Partial<ManualQuoteItem>) {
    setQ((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }))
  }
  function addItem() {
    setQ((s) => ({ ...s, items: [...s.items, { id: rid(), description: '', details: '', quantity: 1, unit: ar ? 'م²' : 'm2', unit_price: null, imageUrl: null }] }))
  }
  function removeItem(id: string) { setQ((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) })) }

  // Custom columns (render on the PDF too).
  function addColumn() {
    setQ((s) => {
      const list = s.columns || []
      if (list.length >= 30) { toast.error(ar ? 'الحد 30 عموداً' : 'Max 30 columns'); return s }
      const n = list.length + 1
      return { ...s, columns: [...list, { id: rid(), name: ar ? `عمود ${n}` : `Column ${n}` }] }
    })
  }
  // Insert a new empty column at a specific position (between existing columns).
  function insertColumnAt(index: number) {
    setQ((s) => {
      const list = [...(s.columns || [])]
      if (list.length >= 30) { toast.error(ar ? 'الحد 30 عموداً' : 'Max 30 columns'); return s }
      const n = list.length + 1
      list.splice(index, 0, { id: rid(), name: ar ? `عمود ${n}` : `Column ${n}` })
      return { ...s, columns: list }
    })
  }
  function renameColumn(id: string, name: string) {
    setQ((s) => ({ ...s, columns: (s.columns || []).map((c) => (c.id === id ? { ...c, name } : c)) }))
  }
  function removeColumn(id: string) {
    setQ((s) => ({
      ...s,
      columns: (s.columns || []).filter((c) => c.id !== id),
      items: s.items.map((it) => { if (!it.custom) return it; const cu = { ...it.custom }; delete cu[id]; return { ...it, custom: cu } }),
    }))
  }
  function setItemCustom(id: string, colId: string, val: string) {
    setQ((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, custom: { ...(it.custom || {}), [colId]: val } } : it)) }))
  }
  function importItems(newItems: ManualQuoteItem[]) {
    setQ((s) => ({ ...s, items: [...s.items, ...newItems] }))
    toast.success(ar ? `أُضيف ${newItems.length} بند ✓` : `${newItems.length} items added ✓`)
  }

  // Import a BOQ file (xlsx/xls/csv): mirror EVERY column exactly as a custom
  // column and every row as an item, values verbatim. Replaces the current
  // columns + items (the BOQ defines the whole table). The team then prices +
  // curates (rename/delete/insert columns, fill Price/Qty).
  async function onBoqFile(file: File) {
    setBoqLoading(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) { toast.error(ar ? 'الملف فارغ' : 'Empty file'); return }
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
      if (grid.length < 1) { toast.error(ar ? 'لا صفوف في الملف' : 'No rows in file'); return }
      // First non-empty row = headers.
      const headerRow = (grid[0] || []).map((h) => String(h ?? '').trim())
      const bodyRows = grid.slice(1).filter((r) => (r || []).some((c) => String(c ?? '').trim() !== ''))
      if (bodyRows.length === 0) { toast.error(ar ? 'لا صفوف بيانات بعد العناوين' : 'No data rows after the header'); return }
      // Table width = the WIDEST row, not just the header — some BOQs carry
      // values in trailing columns the header left blank; keying off the header
      // alone would silently drop those cells. Extra columns get a fallback name.
      let width = headerRow.length
      for (const r of bodyRows) width = Math.max(width, (r || []).length)
      if (width === 0) { toast.error(ar ? 'لا أعمدة في الملف' : 'No columns in file'); return }
      if (width > 30) { toast.error(ar ? 'الملف يتجاوز 30 عموداً — احذف أعمدة زائدة ثم أعد الرفع' : 'File exceeds 30 columns'); return }
      if ((q.columns?.length || 0) > 0 || q.items.length > 0) {
        if (!window.confirm(ar ? 'سيُستبدل الجدول الحالي (الأعمدة والبنود) بمحتوى ملف الـ BOQ. متابعة؟' : 'This replaces the current table (columns + items) with the BOQ file. Continue?')) return
      }
      const columns: ManualQuoteColumn[] = Array.from({ length: width }, (_, i) => ({ id: rid(), name: (headerRow[i] || '').trim() || (ar ? `عمود ${i + 1}` : `Column ${i + 1}`) }))
      const items: ManualQuoteItem[] = bodyRows.map((r) => ({
        id: rid(), description: '', details: '', quantity: 0, unit: '', unit_price: null, imageUrl: null, notes: '',
        custom: Object.fromEntries(columns.map((c, i) => [c.id, String(r[i] ?? '').trim()])),
      }))
      setQ((s) => ({ ...s, columns, items }))
      toast.success(ar ? `تم سحب ${columns.length} عمود و ${items.length} صف ✓` : `Pulled ${columns.length} columns × ${items.length} rows ✓`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (ar ? 'تعذّر قراءة الملف' : 'Could not read the file'))
    } finally {
      setBoqLoading(false)
    }
  }

  async function uploadThumb(id: string, file: File) {
    setUploadingId(id)
    try {
      const up = await uploadFile(file, 'furn') // reuse the furn image policy
      setItem(id, { imageUrl: up.url })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'فشل رفع الصورة')
    } finally {
      setUploadingId(null)
    }
  }

  const itemsSum = q.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  const shipping = q.delivery === 'excluded' ? Math.max(0, Number(q.shipping) || 0) : 0
  const subtotal = itemsSum + shipping
  const vat = subtotal * (q.vat_rate || 0)
  const total = subtotal + vat
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  async function save(thenPrint = false) {
    setSaving(true)
    try {
      const res = await fetch(`/api/manual-quotes/${q.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success(ar ? 'تم الحفظ ✓' : 'Saved ✓')
      if (thenPrint) window.open(`/print/manual-quote/${q.id}`, '_blank')
    } catch { toast.error('فشل الحفظ') } finally { setSaving(false) }
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-4xl mx-auto">
      <button onClick={() => router.push('/manual-quotes')} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <Back className="w-4 h-4" /> {ar ? 'العروض اليدوية' : 'Manual quotes'}
      </button>

      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold">{ar ? 'عرض سعر' : 'Quotation'} <span className="text-teal-600">#{q.number}</span></h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            {(['ar', 'en'] as const).map((l) => (
              <button key={l} onClick={() => set('language', l)} className={`px-3 py-1 rounded-md ${q.language === l ? 'bg-teal-600 text-white' : 'text-muted-foreground'}`}>{l === 'ar' ? 'عربي' : 'EN'}</button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            {(['SAR', 'USD'] as const).map((c) => (
              <button key={c} onClick={() => set('currency', c)} className={`px-3 py-1 rounded-md ${q.currency === c ? 'bg-teal-600 text-white' : 'text-muted-foreground'}`}>{c}</button>
            ))}
          </div>
        </div>
      </div>

      <Card className="mb-4"><CardHeader><CardTitle className="text-base">{ar ? 'بيانات العميل' : 'Client'}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1"><Label>{ar ? 'اسم المشروع' : 'Project name'}</Label><Input value={q.project_name ?? ''} onChange={(e) => set('project_name', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الشركة' : 'Company'}</Label><Input value={q.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'اسم المهندس / العميل' : 'Contact name'}</Label><Input value={q.client_name} onChange={(e) => set('client_name', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الإيميل' : 'Email'}</Label><Input dir="ltr" value={q.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الجوال' : 'Phone'}</Label><Input dir="ltr" value={q.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="space-y-1 md:col-span-2"><Label>{ar ? 'الموضوع' : 'Subject'}</Label><Input value={q.subject ?? ''} onChange={(e) => set('subject', e.target.value)} placeholder={ar ? 'مثال: توريد رخام لمشروع الفلل' : 'e.g. Marble supply for the villas'} /></div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">{ar ? 'البنود' : 'Items'}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`inline-flex items-center gap-1 h-8 px-3 rounded-md border text-sm hover:bg-muted/50 ${boqLoading ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`} title={ar ? 'يسحب كل أعمدة الـ BOQ كما هي' : 'Pulls every BOQ column as-is'}>
              {boqLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}{ar ? 'رفع BOQ (سحب الأعمدة)' : 'Upload BOQ'}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={boqLoading} onChange={(e) => { const f = e.target.files?.[0]; if (f) onBoqFile(f); e.target.value = '' }} />
            </label>
            <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)} className="gap-1"><ClipboardPaste className="w-4 h-4" />{ar ? 'لصق من إكسل' : 'Paste from Excel'}</Button>
            <Button size="sm" variant="outline" onClick={addItem} className="gap-1"><Plus className="w-4 h-4" />{ar ? 'بند' : 'Item'}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Custom columns (appear on the PDF). */}
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <span className="text-xs text-muted-foreground">{ar ? 'أعمدة مخصّصة:' : 'Custom columns:'}</span>
            {cols.map((c, i) => (
              <Fragment key={c.id}>
                <button type="button" onClick={() => insertColumnAt(i)} title={ar ? 'إدراج عمود هنا' : 'Insert column here'}
                  className="text-teal-600/70 hover:text-teal-700 leading-none text-sm font-bold px-0.5" aria-label={ar ? 'إدراج عمود' : 'Insert column'}>+</button>
                <span className="inline-flex items-center gap-1 rounded-md border bg-muted/30 px-1.5 py-0.5">
                  <input value={c.name} onChange={(e) => renameColumn(c.id, e.target.value)} className="bg-transparent outline-none text-xs w-24" />
                  <button type="button" onClick={() => removeColumn(c.id)} className="text-muted-foreground hover:text-red-600"><X className="w-3 h-3" /></button>
                </span>
              </Fragment>
            ))}
            <Button size="sm" variant="ghost" onClick={addColumn} className="gap-1 h-7 text-xs"><Plus className="w-3 h-3" />{ar ? 'عمود' : 'Column'}</Button>
          </div>

          {q.items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{ar ? 'لا بنود بعد' : 'No items yet'}</p>}
          {q.items.map((it, idx) => (
            <div key={it.id} className="rounded-lg border p-2 flex flex-col sm:flex-row gap-2">
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-muted-foreground">{idx + 1}</span>
                <label className="w-14 h-14 rounded-md border bg-muted/40 flex items-center justify-center cursor-pointer overflow-hidden hover:bg-muted/60" title={ar ? 'صورة البند' : 'Item image'}>
                  {uploadingId === it.id ? <Loader2 className="w-4 h-4 animate-spin" />
                    : it.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <ImagePlus className="w-4 h-4 text-muted-foreground" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadThumb(it.id, f); e.target.value = '' }} />
                </label>
              </div>
              <div className="flex-1 space-y-1">
                <Input value={it.description} onChange={(e) => setItem(it.id, { description: e.target.value })} placeholder={ar ? 'الوصف' : 'Description'} className="h-8 text-sm font-medium" />
                <Input value={it.details} onChange={(e) => setItem(it.id, { details: e.target.value })} placeholder={ar ? 'التفاصيل (سماكة/فنش/مقاس/لون)' : 'Details'} className="h-7 text-xs text-muted-foreground" />
                {cols.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {cols.map((c) => (
                      <Input key={c.id} value={it.custom?.[c.id] || ''} onChange={(e) => setItemCustom(it.id, c.id, e.target.value)} placeholder={c.name} className="h-7 w-28 text-xs" />
                    ))}
                  </div>
                )}
                <Input value={it.notes || ''} onChange={(e) => setItem(it.id, { notes: e.target.value })} placeholder={ar ? 'ملاحظات (تظهر في العرض)' : 'Notes (shown on quote)'} className="h-7 text-xs" />
              </div>
              <div className="flex gap-1 items-start">
                <Input type="number" min={0} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Number(e.target.value) })} className="h-8 w-16 text-sm" placeholder={ar ? 'كمية' : 'Qty'} />
                <Input value={it.unit} onChange={(e) => setItem(it.id, { unit: e.target.value })} className="h-8 w-16 text-sm" placeholder={ar ? 'وحدة' : 'Unit'} />
                <Input type="number" min={0} step={0.01} value={it.unit_price ?? ''} onChange={(e) => setItem(it.id, { unit_price: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-20 text-sm" placeholder={ar ? 'سعر' : 'Price'} />
                <span className="h-8 min-w-20 px-2 inline-flex items-center justify-end text-sm font-medium tabular-nums">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => removeItem(it.id)} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4"><CardContent className="p-4 space-y-2">
        <div className="space-y-1"><Label>{ar ? 'ملاحظات' : 'Notes'}</Label><Textarea rows={2} value={q.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        <div className="space-y-1 pt-1">
          <Label>{ar ? 'التوصيل' : 'Delivery'}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border p-0.5 text-xs">
              {([['none', ar ? 'بدون ذكر' : 'None'], ['included', ar ? 'شامل التوصيل' : 'Included'], ['excluded', ar ? 'غير شامل' : 'Not included']] as const).map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => set('delivery', val)}
                  className={`px-3 py-1 rounded-md ${q.delivery === val ? 'bg-teal-600 text-white' : 'text-muted-foreground'}`}>{lbl}</button>
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
        <div className="flex flex-col items-end gap-1 text-sm pt-2 border-t">
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'المجموع' : 'Subtotal'}</span><span className="tabular-nums w-28 text-end">{money(subtotal)}</span></div>
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'الضريبة' : 'VAT'} {(q.vat_rate * 100).toFixed(0)}%</span><span className="tabular-nums w-28 text-end">{money(vat)}</span></div>
          <div className="flex gap-8 font-bold text-base"><span>{ar ? 'الإجمالي' : 'Total'}</span><span className="tabular-nums w-28 text-end">{money(total)} {q.currency}</span></div>
        </div>
      </CardContent></Card>

      <Card className="mb-4"><CardContent className="p-3">
        <QuoteTermsControl scopeKey={`manual:${q.id}`} uiAr={ar} quoteLang={q.language} />
      </CardContent></Card>

      <div className="flex items-center gap-2">
        <Button onClick={() => save(false)} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
        </Button>
        <Button variant="outline" onClick={() => save(true)} disabled={saving} className="gap-2">
          <Printer className="w-4 h-4" />{ar ? 'حفظ وطباعة/PDF' : 'Save & Print/PDF'}
        </Button>
      </div>

      {pasteOpen && (
        <ExcelPasteDialog columns={cols} ar={ar} onClose={() => setPasteOpen(false)} onImport={importItems} />
      )}
    </div>
  )
}
