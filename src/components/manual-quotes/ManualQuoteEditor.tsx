'use client'

// عرض يدوي — the editor. Client details + priced line items (each with an
// optional thumbnail uploaded straight to S3) + live totals. Saves the whole
// quote to S3 via PATCH.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Plus, Trash2, Loader2, Save, Printer, ImagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/contexts/LanguageContext'
import { uploadFile } from '@/lib/upload-client'
import type { ManualQuote, ManualQuoteItem } from '@/lib/manual-quotes/store'

function rid() { return `${Math.random().toString(36).slice(2, 10)}` }

export function ManualQuoteEditor({ initial }: { initial: ManualQuote }) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const Back = isRtl ? ArrowRight : ArrowLeft

  const [q, setQ] = useState<ManualQuote>(initial)
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  function set<K extends keyof ManualQuote>(k: K, v: ManualQuote[K]) { setQ((s) => ({ ...s, [k]: v })) }
  function setItem(id: string, patch: Partial<ManualQuoteItem>) {
    setQ((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }))
  }
  function addItem() {
    setQ((s) => ({ ...s, items: [...s.items, { id: rid(), description: '', details: '', quantity: 1, unit: ar ? 'م²' : 'm2', unit_price: null, imageUrl: null }] }))
  }
  function removeItem(id: string) { setQ((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) })) }

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

  const subtotal = q.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
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
          <div className="space-y-1"><Label>{ar ? 'الشركة' : 'Company'}</Label><Input value={q.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'اسم العميل' : 'Contact name'}</Label><Input value={q.client_name} onChange={(e) => set('client_name', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الإيميل' : 'Email'}</Label><Input dir="ltr" value={q.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="space-y-1"><Label>{ar ? 'الجوال' : 'Phone'}</Label><Input dir="ltr" value={q.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{ar ? 'البنود' : 'Items'}</CardTitle>
          <Button size="sm" variant="outline" onClick={addItem} className="gap-1"><Plus className="w-4 h-4" />{ar ? 'بند' : 'Item'}</Button>
        </CardHeader>
        <CardContent className="space-y-2">
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
        <div className="flex flex-col items-end gap-1 text-sm pt-2 border-t">
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'المجموع' : 'Subtotal'}</span><span className="tabular-nums w-28 text-end">{money(subtotal)}</span></div>
          <div className="flex gap-8"><span className="text-muted-foreground">{ar ? 'الضريبة' : 'VAT'} {(q.vat_rate * 100).toFixed(0)}%</span><span className="tabular-nums w-28 text-end">{money(vat)}</span></div>
          <div className="flex gap-8 font-bold text-base"><span>{ar ? 'الإجمالي' : 'Total'}</span><span className="tabular-nums w-28 text-end">{money(total)} {q.currency}</span></div>
        </div>
      </CardContent></Card>

      <div className="flex items-center gap-2">
        <Button onClick={() => save(false)} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
        </Button>
        <Button variant="outline" onClick={() => save(true)} disabled={saving} className="gap-2">
          <Printer className="w-4 h-4" />{ar ? 'حفظ وطباعة/PDF' : 'Save & Print/PDF'}
        </Button>
      </div>
    </div>
  )
}
