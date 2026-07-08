'use client'

// "النفق السحري" — upload a real photo, pick/upload a product, then either clad
// a surface or place the product. Renders run in the BACKGROUND on the server
// (survive page navigation / browser close); every result is saved to S3 and
// shown in the gallery below — always available, with notes, and deletable.

import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { Wand2, Upload, Loader2, Download, Image as ImageIcon, Sparkles, Search, Check, Trash2, AlertCircle, StickyNote, Cpu, Lock } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { IMAGE_PROVIDERS, DEFAULT_PROVIDER, defaultModelFor, type ImageProvider } from '@/lib/ai/image-models'

interface ProductLite {
  id: string
  name_en: string | null
  name_ar: string | null
}

interface JobView {
  id: string
  status: 'processing' | 'done' | 'failed'
  mode: 'surface' | 'place'
  productName: string
  surfaces: string[]
  placementHint: string
  notes: string
  provider: string
  model: string
  quality: string
  resultUrl: string | null
  error: string | null
  createdByName: string | null
  createdAt: string
}

interface Props {
  products: ProductLite[]
  images: Record<string, string>
  // Product ids ordered most-used first (from the S3 usage store).
  topProductIds: string[]
}

const SURFACES = [
  { key: 'floor', ar: 'أرضية', en: 'Floor' },
  { key: 'stairs', ar: 'درج', en: 'Stairs' },
  { key: 'wall', ar: 'جدار', en: 'Wall' },
  { key: 'ceiling', ar: 'سقف', en: 'Ceiling' },
  { key: 'countertop', ar: 'سطح / كاونتر', en: 'Countertop' },
  { key: 'table', ar: 'طاولة', en: 'Table' },
  { key: 'facade', ar: 'واجهة', en: 'Facade' },
  { key: 'column', ar: 'عمود', en: 'Column' },
]
const SURFACE_LABEL: Record<string, { ar: string; en: string }> = Object.fromEntries(SURFACES.map(s => [s.key, { ar: s.ar, en: s.en }]))

function pick(en: string | null, ar: string | null, isRtl: boolean): string {
  return (isRtl ? ar || en : en || ar) || '—'
}

const TOP_N = 5
// Simple cost-control gate: OpenAI is locked behind this password (Gemini is the
// free-to-use default). Not hard security — just stops casual OpenAI usage.
const OPENAI_LOCK = '100200300'

export function VisualizeClient({ products, images, topProductIds }: Props) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'

  // Scene
  const [sceneUrl, setSceneUrl] = useState('')
  const [scenePreview, setScenePreview] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Product source
  const [source, setSource] = useState<'catalog' | 'upload'>('catalog')
  const [productId, setProductId] = useState('')
  const [search, setSearch] = useState('')
  const [customUrl, setCustomUrl] = useState('')
  const [customPreview, setCustomPreview] = useState('')
  const [uploadingProduct, setUploadingProduct] = useState(false)
  const productFileRef = useRef<HTMLInputElement>(null)

  // Operation
  const [mode, setMode] = useState<'surface' | 'place'>('surface')
  const [surfaces, setSurfaces] = useState<string[]>([])
  const [placementHint, setPlacementHint] = useState('')
  const [notes, setNotes] = useState('')

  // Engine (per render) — provider/model/quality, to control cost.
  const [provider, setProvider] = useState<ImageProvider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState<string>(defaultModelFor(DEFAULT_PROVIDER))
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high')
  const [imageModels, setImageModels] = useState<{ openai: string[]; gemini: string[] }>({ openai: [], gemini: [] })
  const [openaiUnlocked, setOpenaiUnlocked] = useState(false)
  const [lockPrompt, setLockPrompt] = useState(false)
  const [lockInput, setLockInput] = useState('')
  const providerInfo = IMAGE_PROVIDERS[provider]

  function changeProvider(p: ImageProvider) {
    // OpenAI is gated behind a password (cost control). Gemini stays default.
    if (p === 'openai' && !openaiUnlocked) { setLockPrompt(true); return }
    setProvider(p)
    setModel(defaultModelFor(p)) // reset to that provider's default model
  }

  function unlockOpenai() {
    if (lockInput === OPENAI_LOCK) {
      setOpenaiUnlocked(true)
      setLockPrompt(false)
      setLockInput('')
      setProvider('openai')
      setModel(defaultModelFor('openai'))
    } else {
      toast.error(ar ? 'الرقم السري غير صحيح' : 'Wrong password')
    }
  }

  // Live image models merged with the catalogue (known ids get friendly labels;
  // any new/extra live id shows as-is — so new models appear automatically).
  const modelOptions = useMemo(() => {
    const catalog = providerInfo.models
    const labelOf = (id: string) => {
      const c = catalog.find(m => m.id === id)
      return c ? `${c.label}${c.hint ? ` — ${c.hint}` : ''}` : id
    }
    const live = imageModels[provider] || []
    const ids = live.length ? [...live] : catalog.map(m => m.id)
    if (model && !ids.includes(model)) ids.unshift(model)
    return ids.map(id => ({ id, label: labelOf(id) }))
  }, [imageModels, provider, model, providerInfo])

  const [submitting, setSubmitting] = useState(false)

  // Gallery
  const [jobs, setJobs] = useState<JobView[]>([])
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const selectedProduct = products.find(p => p.id === productId)
  const productImageUrl = source === 'upload' ? customUrl : (productId ? images[productId] : '')
  const productName = source === 'upload' ? '' : (selectedProduct ? pick(selectedProduct.name_en, selectedProduct.name_ar, isRtl) : '')
  const productPreview = source === 'upload' ? customPreview : productImageUrl

  // Default (no search): the few most-used products only. Search: the whole
  // catalogue (capped), so the picker stays clean at 1000+ products.
  const topProducts = useMemo(() => {
    const byId = new Map(products.map(p => [p.id, p]))
    const ranked: ProductLite[] = []
    for (const id of topProductIds) { const p = byId.get(id); if (p) ranked.push(p) }
    if (ranked.length < TOP_N) {
      const have = new Set(ranked.map(p => p.id))
      for (const p of products) { if (ranked.length >= TOP_N) break; if (!have.has(p.id)) ranked.push(p) }
    }
    return ranked.slice(0, TOP_N)
  }, [products, topProductIds])

  const trimmed = search.trim().toLowerCase()
  const results = useMemo(() => {
    if (!trimmed) return topProducts
    return products
      .filter(p => (p.name_en || '').toLowerCase().includes(trimmed) || (p.name_ar || '').toLowerCase().includes(trimmed))
      .slice(0, 50)
  }, [trimmed, products, topProducts])

  // ── Gallery polling ────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/visualize/jobs')
      const j = await res.json().catch(() => ({}))
      if (Array.isArray(j.jobs)) setJobs(j.jobs)
    } catch { /* keep the last list on a transient error */ }
  }, [])

  const loadImageModels = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/image-models')
      const j = await res.json().catch(() => ({}))
      if (Array.isArray(j.openai) || Array.isArray(j.gemini)) {
        setImageModels({ openai: j.openai || [], gemini: j.gemini || [] })
      }
    } catch { /* keep the catalogue fallback */ }
  }, [])

  useEffect(() => {
    // Defer first loads off the effect body (timer callbacks, like the interval)
    // so they don't setState synchronously during the effect.
    const first = setTimeout(refetch, 0)
    const t = setInterval(refetch, 5000)
    const models = setTimeout(loadImageModels, 0)
    return () => { clearTimeout(first); clearInterval(t); clearTimeout(models) }
  }, [refetch, loadImageModels])

  function toggleSurface(k: string) {
    setSurfaces(prev => (prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]))
  }

  async function uploadFile(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'visualize')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    if (!j.url) { toast.error(j.error || 'Upload failed'); return null }
    return j.url as string
  }

  async function uploadScene(file: File) {
    setUploading(true)
    const url = await uploadFile(file)
    setUploading(false)
    if (!url) return
    setSceneUrl(url)
    setScenePreview(URL.createObjectURL(file))
  }

  async function uploadProduct(file: File) {
    setUploadingProduct(true)
    const url = await uploadFile(file)
    setUploadingProduct(false)
    if (!url) return
    setCustomUrl(url)
    setCustomPreview(URL.createObjectURL(file))
  }

  async function generate() {
    if (!sceneUrl) { toast.error(ar ? 'ارفع صورة المكان أولاً' : 'Upload a photo first'); return }
    if (!productImageUrl) { toast.error(ar ? 'اختر منتجاً أو ارفع صورة منتج' : 'Pick a product or upload a product image'); return }
    if (mode === 'surface' && surfaces.length === 0) { toast.error(ar ? 'اختر سطحاً واحداً على الأقل' : 'Pick at least one surface'); return }
    setSubmitting(true)
    const res = await fetch('/api/visualize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneUrl, mode, productImageUrl, marbleName: productName,
        productId: source === 'catalog' ? productId : '',
        surfaces: mode === 'surface' ? surfaces : [],
        placementHint: mode === 'place' ? placementHint : '',
        notes,
        provider, model, quality,
      }),
    })
    const j = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { toast.error(j.error || 'Failed', { duration: 12000 }); return }
    setNotes('')
    toast.success(ar ? 'بدأ التركيب في الخلفية — بيظهر في المعرض تحت' : 'Rendering in the background — it will appear in the gallery below')
    refetch()
  }

  async function saveNote(id: string) {
    const notesVal = noteDrafts[id] ?? ''
    const res = await fetch(`/api/visualize/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal }),
    })
    if (!res.ok) { toast.error(ar ? 'تعذّر حفظ الملاحظة' : 'Could not save note'); return }
    setNoteDrafts(d => { const n = { ...d }; delete n[id]; return n })
    toast.success(ar ? 'حُفظت الملاحظة' : 'Note saved')
    refetch()
  }

  async function removeJob(id: string) {
    if (!confirm(ar ? 'حذف هذا التصميم نهائياً؟' : 'Delete this design permanently?')) return
    setJobs(prev => prev.filter(j => j.id !== id))
    const res = await fetch(`/api/visualize/jobs/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error(ar ? 'تعذّر الحذف' : 'Could not delete'); refetch(); return }
    toast.success(ar ? 'تم الحذف' : 'Deleted')
  }

  const processingCount = jobs.filter(j => j.status === 'processing').length

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
          <Wand2 className="w-5 h-5" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold">{ar ? 'النفق السحري' : 'Magic Tunnel'}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {ar
          ? 'ارفع صورة المكان، اختر المنتج، ثم اكسُ سطحاً أو ضع المنتج. التركيب يشتغل في الخلفية وينحفظ في المعرض.'
          : "Upload the photo, pick a product, then clad a surface or place it. Rendering runs in the background and is saved to the gallery."}
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 1. Scene photo */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">{ar ? '١) صورة المكان' : '1) The photo'}</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadScene(f); e.target.value = '' }} />
            {scenePreview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={scenePreview} alt="" className="w-full rounded-lg border object-contain max-h-72" />
                <Button type="button" size="sm" variant="secondary" className="absolute top-2 end-2" onClick={() => fileRef.current?.click()}>
                  {ar ? 'تغيير' : 'Change'}
                </Button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="w-full h-44 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/30 transition">
                {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                <span className="text-sm">{ar ? 'ارفع صورة' : 'Upload photo'}</span>
              </button>
            )}
          </CardContent>
        </Card>

        {/* 2. Product */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{ar ? '٢) المنتج' : '2) The product'}</p>
              <div className="inline-flex rounded-lg border p-0.5 text-xs">
                <button type="button" onClick={() => setSource('catalog')}
                  className={['px-2.5 py-1 rounded-md transition', source === 'catalog' ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted'].join(' ')}>
                  {ar ? 'من الكتالوج' : 'Catalog'}
                </button>
                <button type="button" onClick={() => setSource('upload')}
                  className={['px-2.5 py-1 rounded-md transition', source === 'upload' ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted'].join(' ')}>
                  {ar ? 'رفع سريع' : 'Quick upload'}
                </button>
              </div>
            </div>

            {source === 'catalog' ? (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={ar ? `ابحث في ${products.length} منتج…` : `Search ${products.length} products…`}
                    className="w-full h-10 bg-background border border-input rounded-md text-sm ps-9 pe-3" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {trimmed
                    ? (ar ? `${results.length} نتيجة` : `${results.length} results`)
                    : (ar ? '⭐ الأكثر استخداماً — اكتب للبحث في كل المنتجات' : '⭐ Most used — type to search all products')}
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                  {results.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">{ar ? 'لا نتائج' : 'No results'}</p>
                  ) : results.map(p => (
                    <button key={p.id} type="button" onClick={() => setProductId(p.id)}
                      className={['w-full flex items-center gap-2 px-3 py-2 text-sm text-start transition', productId === p.id ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'hover:bg-muted/50'].join(' ')}>
                      <span className="w-7 h-7 rounded bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        {images[p.id]
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={images[p.id]} alt="" className="w-full h-full object-cover" />
                          : <ImageIcon className="w-3.5 h-3.5 opacity-40" />}
                      </span>
                      <span className="flex-1 truncate">{pick(p.name_en, p.name_ar, isRtl)}</span>
                      {productId === p.id && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
                    </button>
                  ))}
                </div>
                {trimmed && results.length >= 50 && (
                  <p className="text-[11px] text-muted-foreground">
                    {ar ? 'يُعرض أول 50 نتيجة — حدّد البحث أكثر' : 'Showing first 50 — refine your search'}
                  </p>
                )}
              </>
            ) : (
              <>
                <input ref={productFileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadProduct(f); e.target.value = '' }} />
                <button type="button" onClick={() => productFileRef.current?.click()} disabled={uploadingProduct}
                  className="w-full h-10 border-2 border-dashed rounded-md flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted/30 transition">
                  {uploadingProduct ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {ar ? 'ارفع صورة منتج للتجربة' : 'Upload a product image'}
                </button>
              </>
            )}

            <div className="h-32 rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center">
              {productPreview
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={productPreview} alt="" className="w-full h-full object-cover" />
                : <div className="text-center text-muted-foreground text-xs"><ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-40" />{ar ? 'لا توجد صورة بعد' : 'No image yet'}</div>}
            </div>
            {source === 'catalog' && productId && !productImageUrl && (
              <p className="text-xs text-amber-600">
                {ar ? 'هذا المنتج بدون صورة — يعتمد الذكاء على الاسم فقط.' : 'This product has no image — the AI relies on the name only.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3. Operation + notes */}
      <Card className="mt-4">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMode('surface')}
              className={['flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition', mode === 'surface' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30' : 'border-border hover:bg-muted'].join(' ')}>
              {ar ? '🧱 كسوة سطح' : '🧱 Clad a surface'}
            </button>
            <button type="button" onClick={() => setMode('place')}
              className={['flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition', mode === 'place' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30' : 'border-border hover:bg-muted'].join(' ')}>
              {ar ? '🪑 وضع منتج' : '🪑 Place product'}
            </button>
          </div>

          {mode === 'surface' ? (
            <>
              <p className="text-sm font-semibold">{ar ? 'أين نركّب الخامة؟ (يمكن اختيار أكثر من سطح)' : 'Where to apply it? (multi-select)'}</p>
              <div className="flex flex-wrap gap-2">
                {SURFACES.map(s => (
                  <button key={s.key} type="button" onClick={() => toggleSurface(s.key)}
                    className={['px-3 py-1.5 rounded-full border text-sm transition-colors', surfaces.includes(s.key) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30' : 'border-border hover:bg-muted'].join(' ')}>
                    {ar ? s.ar : s.en}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{ar ? 'وين نحط المنتج؟ (اختياري)' : 'Where to place it? (optional)'}</p>
              <input value={placementHint} onChange={e => setPlacementHint(e.target.value)}
                placeholder={ar ? 'مثال: مكان المغسلة الفارغ على اليمين — أو اتركه فاضي' : 'e.g. the empty vanity spot on the right — or leave blank'}
                className="w-full h-10 bg-background border border-input rounded-md text-sm px-3" />
              <p className="text-xs text-muted-foreground">
                {ar ? 'اتركه فاضي والذكاء يختار أنسب مكان طبيعي للمنتج.' : 'Leave blank and the AI picks the most natural spot.'}
              </p>
            </>
          )}

          <div>
            <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5"><StickyNote className="w-4 h-4" />{ar ? 'ملاحظات على التصميم (اختياري)' : 'Design notes (optional)'}</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder={ar ? 'أي ملاحظة تبي ترفقها مع هذا التصميم…' : 'Any note to attach to this design…'}
              className="w-full bg-background border border-input rounded-md text-sm px-3 py-2 resize-y" />
          </div>

          {/* Engine — provider / model / quality (per render, for cost control) */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><Cpu className="w-4 h-4" />{ar ? 'المحرك (للتحكم بالتكلفة)' : 'Engine (cost control)'}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="inline-flex rounded-lg border p-0.5 text-xs w-full">
                {(Object.keys(IMAGE_PROVIDERS) as ImageProvider[]).map(p => (
                  <button key={p} type="button" onClick={() => changeProvider(p)}
                    className={['flex-1 px-2.5 py-1.5 rounded-md transition', provider === p ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted'].join(' ')}>
                    {IMAGE_PROVIDERS[p].label}{p === 'openai' && !openaiUnlocked ? ' 🔒' : ''}
                  </button>
                ))}
              </div>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full h-9 bg-background border border-input rounded-md text-sm px-2">
                {modelOptions.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {lockPrompt && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2">
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <input
                  type="password"
                  value={lockInput}
                  onChange={e => setLockInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') unlockOpenai() }}
                  autoFocus
                  placeholder={ar ? 'الرقم السري لاستخدام OpenAI' : 'OpenAI password'}
                  className="flex-1 h-8 bg-background border border-input rounded-md text-sm px-2"
                />
                <Button type="button" size="sm" className="h-8" onClick={unlockOpenai}>{ar ? 'فتح' : 'Unlock'}</Button>
                <button type="button" onClick={() => { setLockPrompt(false); setLockInput('') }} className="text-xs text-muted-foreground hover:underline">{ar ? 'إلغاء' : 'Cancel'}</button>
              </div>
            )}
            {providerInfo.qualities.length > 0 && (
              <select value={quality} onChange={e => setQuality(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full h-9 bg-background border border-input rounded-md text-sm px-2">
                {providerInfo.qualities.map(q => (
                  <option key={q} value={q}>
                    {ar
                      ? `الجودة: ${q === 'low' ? 'منخفضة (أرخص وأسرع)' : q === 'medium' ? 'متوسطة' : 'عالية (أغلى)'}`
                      : `Quality: ${q}`}
                  </option>
                ))}
              </select>
            )}
            {providerInfo.note && <p className="text-xs text-muted-foreground">{providerInfo.note}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-center">
        <Button onClick={generate} disabled={submitting} size="lg" className="bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white hover:opacity-90">
          {submitting
            ? <><Loader2 className="w-5 h-5 me-2 animate-spin" />{ar ? 'جارٍ الإرسال…' : 'Submitting…'}</>
            : <><Sparkles className="w-5 h-5 me-2" />{mode === 'place' ? (ar ? 'ضع المنتج' : 'Place product') : (ar ? 'ركّب الخامة' : 'Apply material')}</>}
        </Button>
      </div>

      {/* Gallery */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">{ar ? 'المصمَّمات المحفوظة' : 'Saved designs'}</h2>
          {processingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-indigo-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />{ar ? `${processingCount} قيد التركيب…` : `${processingCount} rendering…`}
            </span>
          )}
        </div>

        {jobs.length === 0 ? (
          <div className="border-2 border-dashed rounded-xl py-12 text-center text-muted-foreground text-sm">
            {ar ? 'لا توجد تصاميم بعد — أنشئ أول تصميم من الأعلى.' : 'No designs yet — create your first one above.'}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map(job => {
              const draft = noteDrafts[job.id] ?? job.notes
              const dirty = draft !== job.notes
              const summary = job.mode === 'place'
                ? (job.placementHint || (ar ? 'وضع تلقائي' : 'auto-placed'))
                : job.surfaces.map(s => (ar ? SURFACE_LABEL[s]?.ar : SURFACE_LABEL[s]?.en) || s).join('، ')
              return (
                <Card key={job.id} className="overflow-hidden">
                  <div className="relative aspect-square bg-muted/40 flex items-center justify-center">
                    {job.status === 'done' && job.resultUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={job.resultUrl} alt="" className="w-full h-full object-cover" />
                    ) : job.status === 'processing' ? (
                      <div className="text-center text-muted-foreground text-xs px-3">
                        <Loader2 className="w-7 h-7 mx-auto mb-2 animate-spin text-indigo-500" />
                        {ar ? 'جارٍ التركيب… (قد يأخذ دقائق)' : 'Rendering… (may take minutes)'}
                      </div>
                    ) : (
                      <div className="text-center text-red-500 text-xs px-3">
                        <AlertCircle className="w-7 h-7 mx-auto mb-2" />
                        {job.error || (ar ? 'فشل التركيب' : 'Render failed')}
                      </div>
                    )}
                    <span className="absolute top-2 start-2 text-[11px] px-2 py-0.5 rounded-full bg-black/55 text-white">
                      {job.mode === 'place' ? (ar ? 'وضع منتج' : 'Place') : (ar ? 'كسوة سطح' : 'Surface')}
                    </span>
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <p className="text-sm font-medium truncate">{job.productName || (ar ? 'صورة مرفوعة' : 'Uploaded image')}</p>
                    <p className="text-xs text-muted-foreground truncate">{summary}</p>
                    {job.model && (
                      <p className="text-[11px] text-muted-foreground/80 truncate">
                        {job.provider === 'openai' ? `OpenAI · ${job.model}${job.quality ? ' · ' + job.quality : ''}` : `Gemini · ${job.model}`}
                      </p>
                    )}

                    <textarea
                      value={draft}
                      onChange={e => setNoteDrafts(d => ({ ...d, [job.id]: e.target.value }))}
                      rows={2}
                      placeholder={ar ? 'ملاحظات…' : 'Notes…'}
                      className="w-full bg-background border border-input rounded-md text-xs px-2 py-1.5 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      {dirty && (
                        <Button type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={() => saveNote(job.id)}>
                          {ar ? 'حفظ الملاحظة' : 'Save note'}
                        </Button>
                      )}
                      <div className="flex-1" />
                      {job.status === 'done' && job.resultUrl && (
                        <a href={job.resultUrl} download={`kaaseb-${job.id}.png`} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md border hover:bg-muted transition" title={ar ? 'تنزيل' : 'Download'}>
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button type="button" onClick={() => removeJob(job.id)} title={ar ? 'حذف' : 'Delete'}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
