'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, Cookie, Loader2, Sparkles, AlertTriangle,
  FileSpreadsheet, FileText as FileTextIcon, FileDown, Globe2, CheckCircle2, RefreshCw, Save,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { TannoorProject, TannoorItem, TannoorQuotation, TannoorAvailability } from '@/types'

type ItemWithProduct = TannoorItem & {
  tannoor_products?: {
    id: string; name_en: string | null; name_ar: string | null; unit: string
    price_sar: number; price_usd: number; availability: TannoorAvailability | null
  } | null
}

// Internal-only availability pill (mirrors the catalogue). Never printed on the
// customer quotation — it's a stock hint for the sales team.
const AVAILABILITY_STYLES: Record<TannoorAvailability, string> = {
  high:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium:       'bg-blue-50 text-blue-700 border-blue-200',
  low:          'bg-amber-50 text-amber-700 border-amber-200',
  out_of_stock: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

interface Props {
  project: TannoorProject
  initialItems: ItemWithProduct[]
  initialQuotations: TannoorQuotation[]
  canExport: boolean
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

export function TannoorDetail({ project: initialProject, initialItems, initialQuotations, canExport }: Props) {
  const { t, isRtl } = useLanguage()
  const [project, setProject] = useState<TannoorProject>(initialProject)
  const [items, setItems] = useState<ItemWithProduct[]>(initialItems)
  const [quotations, setQuotations] = useState<TannoorQuotation[]>(initialQuotations)
  const [processing, setProcessing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [savingPrices, setSavingPrices] = useState(false)
  const [currency, setCurrency] = useState<'SAR' | 'USD'>('SAR')
  // Audit "source" per item (where the quantity came from) — internal only.
  const [sources, setSources] = useState<Record<string, string>>({})

  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  async function loadSources() {
    try {
      const res = await fetch(`/api/tannoor/projects/${initialProject.id}/sources`)
      if (res.ok) { const j = await res.json(); setSources(j.sources || {}) }
    } catch { /* ignore */ }
  }
  useEffect(() => {
    fetch(`/api/tannoor/projects/${initialProject.id}/sources`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.sources) setSources(j.sources) })
      .catch(() => {})
  }, [initialProject.id])

  async function refreshProject() {
    const res = await fetch(`/api/tannoor/projects/${project.id}`)
    if (!res.ok) return
    const j = await res.json()
    setProject(j.project)
    setItems(j.items || [])
    setQuotations(j.quotations || [])
    loadSources()
  }

  async function runProcess() {
    setProcessing(true)
    const res = await fetch(`/api/tannoor/projects/${project.id}/process`, { method: 'POST' })
    const j = await res.json()
    setProcessing(false)
    if (!res.ok) {
      toast.error(j.error || 'Processing failed')
      await refreshProject()
      return
    }
    if (j.missing_count > 0) {
      toast.warning(`${j.items_count} extracted, ${j.missing_count} missing`)
    } else {
      toast.success(`${j.items_count} items priced`)
    }
    await refreshProject()
  }

  async function generateQuotation(language: 'ar' | 'en') {
    setGenerating(true)
    // Persist any price edits first so the PDF uses the edited numbers.
    if (canExport) await savePrices()
    const res = await fetch(`/api/tannoor/projects/${project.id}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, currency }),
    })
    const j = await res.json()
    setGenerating(false)
    if (!res.ok) {
      toast.error(j.error || 'Quotation failed')
      return
    }
    setQuotations(prev => [j.quotation, ...prev])
    setProject(prev => ({ ...prev, stage: 'quoted', status: 'completed' }))
    toast.success(t('furn_quotation_ready'))
  }

  // Price actually used for a line: the edited unit_price, else the catalog
  // price in the current currency.
  function priceOf(it: ItemWithProduct): number {
    if (it.unit_price != null) return Number(it.unit_price)
    const prod = it.tannoor_products
    return currency === 'USD' ? Number(prod?.price_usd ?? 0) : Number(prod?.price_sar ?? 0)
  }

  function patchItem(itemId: string, patch: Partial<ItemWithProduct>) {
    setItems(prev => prev.map(it => (it.id === itemId ? { ...it, ...patch } : it)))
  }

  // Single-currency project: switching currency re-seeds every line from the
  // catalog price in the new currency. Confirm first since it discards any
  // manual price edits.
  function changeCurrency(c: 'SAR' | 'USD') {
    if (c === currency) return
    const msg = isRtl
      ? 'تبديل العملة يعيد الأسعار من الكتالوج ويمسح تعديلاتك. متابعة؟'
      : 'Switching currency resets prices from the catalogue and discards your edits. Continue?'
    if (!confirm(msg)) return
    setCurrency(c)
    setItems(prev => prev.map(it => {
      const prod = it.tannoor_products
      if (!prod) return { ...it, currency: c }
      const seed = c === 'USD' ? prod.price_usd : prod.price_sar
      return { ...it, unit_price: Number(seed ?? 0), currency: c }
    }))
  }

  async function savePrices() {
    setSavingPrices(true)
    const res = await fetch(`/api/tannoor/projects/${project.id}/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(it => ({ id: it.id, unit_price: it.unit_price ?? null, quantity: it.quantity, currency })),
      }),
    })
    setSavingPrices(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed'); return }
    toast.success(t('furn_save_prices'))
  }

  const subtotal = items.reduce((sum, it) => sum + Number(it.quantity || 0) * priceOf(it), 0)
  const vat = subtotal * 0.15
  const total = subtotal + vat

  const hasMissing = items.some(it => it.is_missing) || (project.ai_missing_items?.length || 0) > 0

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/tannoor" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('furn_back')}
      </Link>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-red-600 text-white flex items-center justify-center shadow-md flex-shrink-0">
            <Cookie className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{display(project.project_name_en, project.project_name_ar, isRtl)}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {display(project.company_en, project.company_ar, isRtl)}
              {project.engineer_phone ? ` · ${project.engineer_phone}` : ''}
            </p>
            {project.subject && <p className="text-xs text-muted-foreground mt-1 italic">{project.subject}</p>}
          </div>
        </div>
      </div>

      {/* Attached files */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-4 space-y-2">
          {project.boq_url && (
            <a href={project.boq_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded border bg-muted/30 hover:bg-muted/60 transition">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span className="text-sm">{project.boq_filename}</span>
            </a>
          )}
          {project.spec_files?.map((f, i) => (
            <a key={`s${i}`} href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded border bg-muted/30 hover:bg-muted/60 transition">
              <FileTextIcon className="w-4 h-4 text-blue-600" /><span className="text-sm">{f.name}</span>
            </a>
          ))}
          {project.drawing_files?.map((f, i) => (
            <a key={`d${i}`} href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded border bg-muted/30 hover:bg-muted/60 transition">
              <FileTextIcon className="w-4 h-4 text-purple-600" /><span className="text-sm">{f.name}</span>
            </a>
          ))}
        </CardContent>
      </Card>

      {/* AI run */}
      {project.ai_error && (
        <Card className="border-0 shadow-sm mb-4">
          <CardContent className="p-4 bg-red-50 border border-red-200 rounded">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">{t('furn_processing_failed')}</p>
                <p className="text-xs text-red-700/80 mt-1 whitespace-pre-wrap">{project.ai_error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Missing products warning */}
      {hasMissing && (
        <Card className="border-0 shadow-sm mb-4">
          <CardContent className="p-4 bg-orange-50 border border-orange-300 rounded">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-orange-700 flex-shrink-0" />
              <p className="text-sm font-bold text-orange-900">{t('tn_status_missing_products')}</p>
            </div>
            <p className="text-xs text-orange-800/80 mb-2">{t('tn_ai_missing')}</p>
            {(project.ai_missing_items || []).length > 0 && (
              <ul className="text-xs text-orange-900 list-disc list-inside space-y-1 mt-2">
                {project.ai_missing_items.map((m, i) => (
                  <li key={i}><span className="font-medium">{m.description}</span>{m.reason ? ` — ${m.reason}` : ''}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Button onClick={runProcess} disabled={processing} className="bg-orange-600 hover:bg-orange-700 text-white">
          {processing
            ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_processing_running')}</>
            : <><Sparkles className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{items.length > 0 ? t('furn_processing_retry') : t('furn_step1_title')}</>}
        </Button>
        {items.length > 0 && (
          <>
            <div className="inline-flex items-center gap-1 rounded-md border p-0.5">
              {(['SAR', 'USD'] as const).map(c => (
                <button key={c} onClick={() => changeCurrency(c)}
                  className={`px-3 py-1 text-xs rounded ${currency === c ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                  {c}
                </button>
              ))}
            </div>
            {canExport && (
              <Button onClick={savePrices} disabled={savingPrices} variant="outline">
                {savingPrices
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Save className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_save_prices')}</>}
              </Button>
            )}
            <Button onClick={refreshProject} variant="outline">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {/* Items table */}
      {items.length > 0 && (
        <Card className="border-0 shadow-sm mb-4">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t('furn_extracted_items')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-12">#</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('furn_item_description')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-32">Product</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-20">{t('furn_item_quantity')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-20">{t('furn_item_unit')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-28">{t('furn_item_price')}</th>
                    <th className="px-3 py-2 text-start font-medium text-muted-foreground w-28">{t('furn_item_total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((it, idx) => {
                    const prod = it.tannoor_products
                    const price = priceOf(it)
                    const lineTotal = Number(it.quantity || 0) * price
                    return (
                      <tr key={it.id} className={it.is_missing ? 'bg-orange-50/60' : ''}>
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2">
                          {it.description}
                          {sources[it.id] && (
                            <div className="text-xs text-muted-foreground mt-0.5" title={isRtl ? 'المصدر (داخلي)' : 'Source (internal)'}>📄 {sources[it.id]}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {prod ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{display(prod.name_en, prod.name_ar, isRtl)}</span>
                              {prod.availability && (
                                <span
                                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${AVAILABILITY_STYLES[prod.availability]}`}
                                  title={isRtl ? 'الوفرة (داخلي فقط)' : 'Availability (internal only)'}
                                >
                                  {t(`tn_p_availability_${prod.availability}` as Parameters<typeof t>[0])}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-orange-700 font-bold inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{t('tn_status_missing_products')}</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{Number(it.quantity).toLocaleString('en-US')}</td>
                        <td className="px-3 py-2">{it.unit}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {!prod ? '—' : canExport ? (
                            <Input
                              type="number" min={0} step="any" inputMode="decimal"
                              value={it.unit_price ?? ''}
                              placeholder={String(price)}
                              onChange={e => patchItem(it.id, { unit_price: e.target.value === '' ? null : Number(e.target.value) })}
                              className="h-8 w-24 tabular-nums"
                            />
                          ) : Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-medium">{prod ? lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted/30 border-t">
                  <tr><td colSpan={6} className="px-3 py-2 text-end font-medium">{t('furn_subtotal')}</td><td className="px-3 py-2 font-bold tabular-nums">{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}</td></tr>
                  <tr><td colSpan={6} className="px-3 py-2 text-end font-medium">{t('furn_vat')}</td><td className="px-3 py-2 font-bold tabular-nums">{vat.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}</td></tr>
                  <tr><td colSpan={6} className="px-3 py-2 text-end font-medium">{t('furn_grand_total')}</td><td className="px-3 py-2 font-bold tabular-nums text-orange-700">{total.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}</td></tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate quote */}
      {items.length > 0 && !hasMissing && canExport && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Button onClick={() => generateQuotation('ar')} disabled={generating} className="bg-orange-600 hover:bg-orange-700 text-white">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Globe2 className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_download_ar')}</>}
          </Button>
          <Button onClick={() => generateQuotation('en')} disabled={generating} variant="outline">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Globe2 className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_download_en')}</>}
          </Button>
        </div>
      )}

      {/* Quotations */}
      {quotations.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">{t('furn_quotation_ready')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {quotations.map(q => (
              <div key={q.id} className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-xs font-bold">#{q.quotation_number}</span>
                  <span className="text-xs text-muted-foreground">{q.language.toUpperCase()}</span>
                  <span className="text-xs text-muted-foreground">{q.currency}</span>
                  <span className="text-xs text-muted-foreground">{new Date(q.generated_at).toLocaleString(isRtl ? 'ar-SA' : 'en-GB')}</span>
                  <span className="text-sm font-medium tabular-nums">{Number(q.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
                <a href={`/print/tannoor-quotation/${project.id}/${q.id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border bg-background hover:bg-muted">
                  <FileDown className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />PDF
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Status banner */}
      {project.status === 'completed' && !hasMissing && (
        <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          {t('furn_status_completed')}
        </div>
      )}
    </div>
  )
}
