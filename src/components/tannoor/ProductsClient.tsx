'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Package, Plus, Trash2, Loader2, Pencil, Copy, Search, ChevronLeft, ChevronRight, Image as ImageIcon, Upload } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { TannoorProduct, TannoorAvailability, FurnDepartment } from '@/types'

interface Props {
  initialProducts: TannoorProduct[]
  departments: FurnDepartment[]
  canManage: boolean
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

interface FormState {
  name_en: string; name_ar: string
  description_en: string; description_ar: string
  department_id: string
  unit: string
  thickness_mm: string
  size_w_mm: string
  size_l_mm: string
  colors: string[]
  finish: string
  availability: '' | TannoorAvailability
  price_sar: number
  price_usd: number
  notes: string
  imageUrl: string
}
const EMPTY: FormState = {
  name_en: '', name_ar: '', description_en: '', description_ar: '',
  department_id: '', unit: 'm',
  thickness_mm: '', size_w_mm: '', size_l_mm: '',
  colors: [], finish: '',
  availability: '',
  price_sar: 0, price_usd: 0, notes: '', imageUrl: '',
}

// Availability is rendered as a coloured pill in the table so the sales
// team can scan stock at a glance. Out-of-stock is muted (not red) — we
// don't want to alarm anyone, just flag the order needs a lead-time chat.
const AVAILABILITY_STYLES: Record<TannoorAvailability, string> = {
  high:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium:       'bg-blue-50 text-blue-700 border-blue-200',
  low:          'bg-amber-50 text-amber-700 border-amber-200',
  out_of_stock: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

// Catalogs grow into the hundreds of variants; render one page at a time so the
// table stays light and scannable.
const PAGE_SIZE = 20

export function ProductsClient({ initialProducts, departments, canManage }: Props) {
  const { t, isRtl } = useLanguage()
  const [products, setProducts] = useState<TannoorProduct[]>(initialProducts)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TannoorProduct | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  // Product photos: { productId → S3 url }. Stored in a local file (no DB
  // column) and merged into the table + dialog.
  const [images, setImages] = useState<Record<string, string>>({})
  const [uploadingImage, setUploadingImage] = useState(false)
  const imgInputRef = useRef<HTMLInputElement>(null)
  // Colours: saved palette + per-product multi-select (S3-backed, no DB column).
  const [palette, setPalette] = useState<string[]>([])
  const [productColors, setProductColors] = useState<Record<string, string[]>>({})
  // thickness + finish per product (DB-missing columns, kept in S3).
  const [productAttrs, setProductAttrs] = useState<Record<string, { thickness_mm: number | null; finish: string | null }>>({})
  const [newColor, setNewColor] = useState('')
  const [colorFilter, setColorFilter] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/tannoor/product-images')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.images) setImages(j.images) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/tannoor/colors')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (j?.palette) setPalette(j.palette)
        if (j?.byProduct) setProductColors(j.byProduct)
        if (j?.attrs) setProductAttrs(j.attrs)
      })
      .catch(() => {})
  }, [])

  function toggleFormColor(c: string) {
    setForm(prev => ({ ...prev, colors: prev.colors.includes(c) ? prev.colors.filter(x => x !== c) : [...prev.colors, c] }))
  }
  function addNewColor() {
    const c = newColor.trim()
    if (!c) return
    setPalette(prev => (prev.includes(c) ? prev : [...prev, c]))
    setForm(prev => ({ ...prev, colors: prev.colors.includes(c) ? prev.colors : [...prev.colors, c] }))
    setNewColor('')
  }
  function toggleColorFilter(c: string) {
    setColorFilter(prev => (prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]))
    setPage(1)
  }

  async function uploadImage(file: File) {
    setUploadingImage(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'tannoor_products')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    setUploadingImage(false)
    if (!j.url) { toast.error(j.error || 'Upload failed'); return }
    patch('imageUrl', j.url)
  }

  // Filter across the fields the team scans by (name / colour / finish / unit /
  // department), in either language. Pagination runs over the filtered set.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(p => {
      // Colour filter: product must have at least one selected colour.
      if (colorFilter.length > 0) {
        const pc = productColors[p.id] || []
        if (!colorFilter.some(c => pc.includes(c))) return false
      }
      if (!q) return true
      const dept = departments.find(d => d.id === p.department_id)
      return [
        p.name_en, p.name_ar, productAttrs[p.id]?.finish, p.unit, dept?.name_en, dept?.name_ar,
        ...(productColors[p.id] || []),
      ].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [products, departments, query, colorFilter, productColors, productAttrs])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  )

  function patch<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }
  function startCreate() {
    setEditing(null); setForm(EMPTY); setOpen(true)
  }
  // Clone an existing variant into the create dialog — most of the catalogue is
  // near-duplicates (same stone, different thickness/finish), so this is the
  // fastest way to add a new row.
  function startDuplicate(p: TannoorProduct) {
    setEditing(null)
    setForm({
      name_en: p.name_en ? `${p.name_en} (copy)` : '',
      name_ar: p.name_ar ? `${p.name_ar} (نسخة)` : '',
      description_en: p.description_en || '', description_ar: p.description_ar || '',
      department_id: p.department_id || '',
      unit: p.unit,
      thickness_mm: productAttrs[p.id]?.thickness_mm == null ? '' : String(productAttrs[p.id]?.thickness_mm),
      size_w_mm: p.size_w_mm == null ? '' : String(p.size_w_mm),
      size_l_mm: p.size_l_mm == null ? '' : String(p.size_l_mm),
      colors: productColors[p.id] || [],
      finish: productAttrs[p.id]?.finish || '',
      availability: p.availability || '',
      price_sar: Number(p.price_sar), price_usd: Number(p.price_usd),
      notes: p.notes || '',
      imageUrl: images[p.id] || '',
    })
    setOpen(true)
  }
  function startEdit(p: TannoorProduct) {
    setEditing(p)
    setForm({
      name_en: p.name_en || '', name_ar: p.name_ar || '',
      description_en: p.description_en || '', description_ar: p.description_ar || '',
      department_id: p.department_id || '',
      unit: p.unit,
      thickness_mm: productAttrs[p.id]?.thickness_mm == null ? '' : String(productAttrs[p.id]?.thickness_mm),
      size_w_mm: p.size_w_mm == null ? '' : String(p.size_w_mm),
      size_l_mm: p.size_l_mm == null ? '' : String(p.size_l_mm),
      colors: productColors[p.id] || [],
      finish: productAttrs[p.id]?.finish || '',
      availability: p.availability || '',
      price_sar: Number(p.price_sar), price_usd: Number(p.price_usd),
      notes: p.notes || '',
      imageUrl: images[p.id] || '',
    })
    setOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name_en.trim() && !form.name_ar.trim()) { toast.error(t('tn_p_name_en')); return }
    setSaving(true)
    const payload: Record<string, unknown> = {
      name_en: form.name_en, name_ar: form.name_ar,
      description_en: form.description_en, description_ar: form.description_ar,
      department_id: form.department_id || null,
      unit: form.unit,
      // thickness_mm + finish go to the S3 extras store (no DB columns).
      size_w_mm: form.size_w_mm.trim() === '' ? null : Number(form.size_w_mm),
      size_l_mm: form.size_l_mm.trim() === '' ? null : Number(form.size_l_mm),
      availability: form.availability || null,
      price_sar: Number(form.price_sar) || 0,
      price_usd: Number(form.price_usd) || 0,
      notes: form.notes,
    }
    const url = editing ? `/api/tannoor/products/${editing.id}` : '/api/tannoor/products'
    const method = editing ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const j = await res.json()
    setSaving(false)
    if (!res.ok) { toast.error(j.error || 'Failed'); return }
    // Persist the product ↔ image association (local map, no DB column).
    try {
      await fetch('/api/tannoor/product-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: j.product.id, url: form.imageUrl || null }),
      })
      setImages(prev => {
        const m = { ...prev }
        if (form.imageUrl) m[j.product.id] = form.imageUrl
        else delete m[j.product.id]
        return m
      })
    } catch { /* non-fatal */ }
    // Persist the product's S3 extras: colours + thickness + finish (DB-missing
    // columns). New colours join the palette.
    const thicknessNum = form.thickness_mm.trim() === '' ? null : Number(form.thickness_mm)
    try {
      const cr = await fetch('/api/tannoor/colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: j.product.id, colors: form.colors, thickness_mm: thicknessNum, finish: form.finish }),
      })
      const cj = await cr.json().catch(() => null)
      if (cj?.palette) setPalette(cj.palette)
      setProductColors(prev => ({ ...prev, [j.product.id]: form.colors }))
      setProductAttrs(prev => ({ ...prev, [j.product.id]: { thickness_mm: thicknessNum, finish: form.finish || null } }))
    } catch { /* non-fatal */ }
    if (editing) setProducts(prev => prev.map(p => p.id === editing.id ? j.product : p))
    else         setProducts(prev => [j.product, ...prev])
    setOpen(false)
  }

  async function handleDelete(p: TannoorProduct) {
    if (!confirm(`Delete "${display(p.name_en, p.name_ar, isRtl)}"?`)) return
    setDeleting(p.id)
    await fetch(`/api/tannoor/products/${p.id}`, { method: 'DELETE' })
    setDeleting(null)
    setProducts(prev => prev.filter(x => x.id !== p.id))
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-rose-600 text-white flex items-center justify-center shadow-md">
            <Package className="w-5 h-5" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">{t('tn_products_title')}</h1>
        </div>
        {canManage && (
          <Button onClick={startCreate} size="lg">
            <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
            {t('tn_products_new')}
          </Button>
        )}
      </div>

      {/* Search — resets to page 1 on every keystroke so results are visible. */}
      <div className="mb-4 relative max-w-sm">
        <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`} />
        <Input
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(1) }}
          placeholder={isRtl ? 'ابحث عن منتج…' : 'Search products…'}
          className={isRtl ? 'pr-9' : 'pl-9'}
        />
      </div>

      {/* Colour filter — show products having any selected colour. */}
      {palette.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground me-1">{isRtl ? 'فلترة باللون:' : 'Filter by colour:'}</span>
          {palette.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => toggleColorFilter(c)}
              className={[
                'px-2.5 py-1 rounded-full border text-xs transition-colors',
                colorFilter.includes(c)
                  ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30'
                  : 'border-border hover:bg-muted',
              ].join(' ')}
            >
              {c}
            </button>
          ))}
          {colorFilter.length > 0 && (
            <button type="button" onClick={() => { setColorFilter([]); setPage(1) }} className="text-xs text-red-500 hover:text-red-600 ms-1">
              {isRtl ? 'مسح' : 'Clear'}
            </button>
          )}
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {products.length === 0 ? t('tn_p_empty') : (isRtl ? 'لا توجد نتائج' : 'No results')}
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_col_name')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_col_dept')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_color')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_finish')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground whitespace-nowrap">{t('tn_p_size_wl')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_thickness')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_unit')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_availability')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_price_sar')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_price_usd')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('tn_p_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginated.map(p => {
                    const dept = departments.find(d => d.id === p.department_id)
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-3 py-3 font-medium">
                          <div className="flex items-center gap-2">
                            {images[p.id]
                              ? <img src={images[p.id]} alt="" className="w-8 h-8 rounded object-cover border flex-shrink-0" />
                              : <div className="w-8 h-8 rounded border bg-muted/30 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-3.5 h-3.5 text-muted-foreground/40" /></div>}
                            <span>{display(p.name_en, p.name_ar, isRtl)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-foreground/80">{dept ? display(dept.name_en, dept.name_ar, isRtl) : '—'}</td>
                        <td className="px-3 py-3">
                          {(productColors[p.id] || []).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {(productColors[p.id] || []).slice(0, 4).map(c => (
                                <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-muted/40 text-foreground/70">{c}</span>
                              ))}
                            </div>
                          ) : <span className="text-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-3 text-foreground/80">{productAttrs[p.id]?.finish || '—'}</td>
                        {/* Size cell — render "W × L mm" if either side is
                            set; show "—" only when both are blank so partial
                            data still surfaces. */}
                        <td className="px-3 py-3 tabular-nums text-foreground/80 whitespace-nowrap" dir="ltr">
                          {p.size_w_mm == null && p.size_l_mm == null
                            ? '—'
                            : `${p.size_w_mm ?? '?'} × ${p.size_l_mm ?? '?'} mm`}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-foreground/80">{productAttrs[p.id]?.thickness_mm == null ? '—' : `${productAttrs[p.id]?.thickness_mm} mm`}</td>
                        <td className="px-3 py-3 text-foreground/80">{p.unit}</td>
                        <td className="px-3 py-3">
                          {p.availability ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs border ${AVAILABILITY_STYLES[p.availability]}`}>
                              {t(`tn_p_availability_${p.availability}` as Parameters<typeof t>[0])}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{Number(p.price_sar).toLocaleString('en-US')}</td>
                        <td className="px-3 py-3 tabular-nums">{Number(p.price_usd).toLocaleString('en-US')}</td>
                        <td className="px-3 py-3">
                          {canManage && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => startEdit(p)} title={isRtl ? 'تعديل' : 'Edit'} className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => startDuplicate(p)} title={isRtl ? 'نسخ' : 'Duplicate'} className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDelete(p)} disabled={deleting === p.id} title={isRtl ? 'حذف' : 'Delete'}
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-50 text-red-600">
                                {deleting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination — only when more than one page of results. */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
                <span className="text-muted-foreground">
                  {isRtl
                    ? `${filtered.length} منتج · صفحة ${safePage} من ${totalPages}`
                    : `${filtered.length} products · page ${safePage} of ${totalPages}`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir={isRtl ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{editing ? t('tn_products_title') : t('tn_products_new')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {/* Product image — thumbnail + upload. Stored in the local image map. */}
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center flex-shrink-0">
                {form.imageUrl
                  ? <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
                  : <ImageIcon className="w-6 h-6 text-muted-foreground/50" />}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => imgInputRef.current?.click()} disabled={uploadingImage}>
                  {uploadingImage
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><Upload className="w-4 h-4 me-2" />{isRtl ? 'صورة المنتج' : 'Product image'}</>}
                </Button>
                {form.imageUrl && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => patch('imageUrl', '')}>
                    {isRtl ? 'إزالة' : 'Remove'}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('tn_p_name_en')}</Label>
                <Input value={form.name_en} onChange={e => patch('name_en', e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_name_ar')}</Label>
                <Input value={form.name_ar} onChange={e => patch('name_ar', e.target.value)} dir="rtl" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t('tn_p_desc_en')}</Label>
                <Input value={form.description_en} onChange={e => patch('description_en', e.target.value)} dir="ltr" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{t('tn_p_desc_ar')}</Label>
                <Input value={form.description_ar} onChange={e => patch('description_ar', e.target.value)} dir="rtl" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_department')}</Label>
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={form.department_id}
                  onChange={e => patch('department_id', e.target.value)}
                >
                  <option value="">—</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{display(d.name_en, d.name_ar, isRtl)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_unit')}</Label>
                <Input value={form.unit} onChange={e => patch('unit', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_thickness')}</Label>
                <Input
                  type="number" min={0} step="any" inputMode="decimal"
                  value={form.thickness_mm}
                  onChange={e => patch('thickness_mm', e.target.value)}
                  placeholder="20 / 30 / 40"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_finish')}</Label>
                <Input
                  value={form.finish}
                  onChange={e => patch('finish', e.target.value)}
                  placeholder="polished / honed / flamed"
                />
              </div>
              {/* Size — entered as two separate dims so the table can render
                  "W × L mm" deterministically and the AI can match on either
                  axis when looking up products. */}
              <div className="space-y-1.5">
                <Label>{t('tn_p_size_w')}</Label>
                <Input
                  type="number" min={0} step="any" inputMode="decimal"
                  value={form.size_w_mm}
                  onChange={e => patch('size_w_mm', e.target.value)}
                  placeholder="600"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_size_l')}</Label>
                <Input
                  type="number" min={0} step="any" inputMode="decimal"
                  value={form.size_l_mm}
                  onChange={e => patch('size_l_mm', e.target.value)}
                  placeholder="1200"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>{isRtl ? 'الألوان (اختر أكثر من لون)' : 'Colours (multi-select)'}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {palette.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleFormColor(c)}
                      className={[
                        'px-2.5 py-1 rounded-full border text-xs transition-colors',
                        form.colors.includes(c)
                          ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30'
                          : 'border-border hover:bg-muted',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  ))}
                  {palette.length === 0 && <span className="text-xs text-muted-foreground">{isRtl ? 'لا توجد ألوان بعد — أضف أدناه' : 'No colours yet — add below'}</span>}
                </div>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={newColor}
                    onChange={e => setNewColor(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewColor() } }}
                    placeholder={isRtl ? 'أضف لوناً جديداً…' : 'Add a new colour…'}
                    className="h-8 max-w-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addNewColor}>{isRtl ? 'إضافة' : 'Add'}</Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_availability')}</Label>
                <select
                  className="w-full h-9 bg-background border border-input rounded-md text-sm px-3"
                  value={form.availability}
                  onChange={e => patch('availability', e.target.value as FormState['availability'])}
                >
                  <option value="">—</option>
                  <option value="high">{t('tn_p_availability_high')}</option>
                  <option value="medium">{t('tn_p_availability_medium')}</option>
                  <option value="low">{t('tn_p_availability_low')}</option>
                  <option value="out_of_stock">{t('tn_p_availability_out_of_stock')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_price_sar')}</Label>
                <Input type="number" min={0} step={0.01} value={form.price_sar} onChange={e => patch('price_sar', Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('tn_p_price_usd')}</Label>
                <Input type="number" min={0} step={0.01} value={form.price_usd} onChange={e => patch('price_usd', Number(e.target.value))} />
              </div>
            </div>
            <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 px-6 py-3 bg-background border-t">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editing ? (isRtl ? 'حفظ' : 'Save') : t('tn_products_new'))}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
