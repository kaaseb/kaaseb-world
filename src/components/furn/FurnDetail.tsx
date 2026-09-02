'use client'

// Furn project detail. Three tabs:
//   • Files      → attachments grouped by category + "Run AI" entry point.
//   • Pricing    → items table with editable prices + save.
//   • Quotations → single "Send" button that generates BOTH AR and EN PDFs,
//                  uploads them to S3, and lists them for download.
//
// Tabs deliberately replace the previous stage-gated stacked view so the
// user can flip back and forth between attachments and prices without
// scrolling, and the act of sending the quotation is a single deliberate
// click (no more two-button "Download AR / Download EN" dance).

import { useEffect, useState, Fragment } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, Flame, Loader2, Sparkles, AlertTriangle, FileSpreadsheet,
  FileText as FileTextIcon, FileDown, Plus, Trash2, RefreshCw, Send,
  Image as ImageIcon, Paperclip, ListChecks,
} from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { QuoteTermsControl } from '@/components/quote-terms/QuoteTermsControl'
import type { FurnProject, FurnItem, FurnQuotation } from '@/types'

interface Props {
  project: FurnProject
  initialItems: FurnItem[]
  initialQuotations: FurnQuotation[]
  canEditPrices: boolean
  canExport: boolean
}

type Tab = 'files' | 'pricing' | 'quotations'

export function FurnDetail({ project: initialProject, initialItems, initialQuotations, canEditPrices, canExport }: Props) {
  const { t, isRtl } = useLanguage()

  const [project, setProject] = useState<FurnProject>(initialProject)
  const [items, setItems] = useState<FurnItem[]>(initialItems)
  const [quotations, setQuotations] = useState<FurnQuotation[]>(initialQuotations)

  const [processing, setProcessing] = useState(false)
  const [savingPrices, setSavingPrices] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  // Email the finished quotation PDF to the client.
  const [emailLang, setEmailLang] = useState<'ar' | 'en'>('ar')
  const [emailTo, setEmailTo] = useState('')
  const [emailingQuote, setEmailingQuote] = useState(false)
  async function emailQuotation() {
    if (emailingQuote) return
    setEmailingQuote(true)
    try {
      const res = await fetch(`/api/furn/projects/${project.id}/send-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: emailLang, to: emailTo.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الإرسال', { duration: 12000 }); return }
      toast.success(`${isRtl ? 'أُرسل العرض إلى' : 'Quotation sent to'} ${j.to} ✓`)
      setEmailTo('')
    } catch {
      toast.error(isRtl ? 'فشل الإرسال' : 'Send failed')
    } finally {
      setEmailingQuote(false)
    }
  }

  // Delivery on the quotation: included → prints a fixed sentence; excluded →
  // adds a priced shipping line into the total; none → nothing. Loaded from /
  // saved to the delivery store via the API.
  const [deliveryChoice, setDeliveryChoice] = useState<'included' | 'excluded' | 'none'>('none')
  const [shippingAmount, setShippingAmount] = useState(0)
  useEffect(() => {
    fetch(`/api/furn/delivery?projectId=${initialProject.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.choice) setDeliveryChoice(j.choice); if (j?.shipping) setShippingAmount(Number(j.shipping)) })
      .catch(() => {})
  }, [initialProject.id])

  async function saveDelivery(choice: 'included' | 'excluded' | 'none', shipping: number) {
    await fetch('/api/furn/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: initialProject.id, choice, shipping }),
    }).catch(() => {})
  }
  function changeDelivery(choice: 'included' | 'excluded' | 'none') {
    setDeliveryChoice(choice)
    saveDelivery(choice, shippingAmount)
  }

  // Audit "source" per item (where each number came from) — read-only, internal.
  const [itemSources, setItemSources] = useState<Record<string, string>>({})
  async function loadItemSources() {
    try {
      const res = await fetch(`/api/furn/projects/${initialProject.id}/sources`)
      if (res.ok) { const j = await res.json(); setItemSources(j.sources || {}) }
    } catch { /* ignore */ }
  }
  useEffect(() => {
    fetch(`/api/furn/projects/${initialProject.id}/sources`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.sources) setItemSources(j.sources) })
      .catch(() => {})
  }, [initialProject.id])

  // Review flags — the router flags doubtful/duplicate rows; the team approves
  // or rejects each here (nothing is ever auto-dropped).
  interface ReviewFlag { reason: string; red: boolean; status: 'pending' | 'approved' | 'rejected' }
  const [itemFlags, setItemFlags] = useState<Record<string, ReviewFlag>>({})
  // Section (Excel sheet) per item — grouped as headers on the pricing screen.
  const [itemSections, setItemSections] = useState<Record<string, string>>({})
  async function loadItemFlags() {
    try {
      const res = await fetch(`/api/furn/projects/${initialProject.id}/flags`)
      if (res.ok) { const j = await res.json(); setItemFlags(j.flags || {}); setItemSections(j.sections || {}) }
    } catch { /* ignore */ }
  }
  useEffect(() => {
    fetch(`/api/furn/projects/${initialProject.id}/flags`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.flags) setItemFlags(j.flags); if (j?.sections) setItemSections(j.sections) })
      .catch(() => {})
  }, [initialProject.id])

  async function setFlagStatus(itemId: string, status: 'approved' | 'rejected') {
    const prev = itemFlags[itemId]
    setItemFlags((m) => ({ ...m, [itemId]: { ...m[itemId], status } }))
    try {
      const res = await fetch(`/api/furn/projects/${initialProject.id}/flags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, status }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setItemFlags((m) => ({ ...m, [itemId]: prev }))
    }
  }

  // Default tab — drop the user where the project actually is in the
  // pipeline so they don't have to re-discover it.
  const [tab, setTab] = useState<Tab>(
    project.stage === 'quoted' ? 'quotations'
    : items.length > 0          ? 'pricing'
    : 'files'
  )

  const ChevronStart = isRtl ? ArrowRight : ArrowLeft

  async function refreshProject() {
    const res = await fetch(`/api/furn/projects/${project.id}`)
    if (!res.ok) return
    const j = await res.json()
    setProject(j.project)
    setItems(j.items || [])
    setQuotations(j.quotations || [])
  }

  // Router progress line ("فهرسة الملفات 34/200…") shown under the running
  // banner. Comes from app-data/furn-runs/<id>.json via the progress endpoint.
  const [runMessage, setRunMessage] = useState('')

  // The process endpoint now returns 202 and runs the router pipeline in the
  // background (indexing 200 attachments takes minutes — no HTTP request
  // survives that). We poll the project + the progress file until the status
  // leaves in_progress-processing, then land exactly where the old flow did.
  async function pollUntilDone() {
    // Cap the poll so a silently-dead background job can't make the client spin
    // forever: the router's worst case is generous but finite, and the server
    // lock frees after 60 min anyway. ~75 min of 4 s ticks then we stop and tell
    // the user to refresh.
    const MAX_TICKS = 1125
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      await new Promise(r => setTimeout(r, 4000))
      try {
        const [pRes, gRes] = await Promise.all([
          fetch(`/api/furn/projects/${project.id}`),
          fetch(`/api/furn/projects/${project.id}/process/progress`),
        ])
        if (gRes.ok) {
          const g = await gRes.json()
          if (g.progress?.message) setRunMessage(g.progress.message)
        }
        if (!pRes.ok) continue
        const j = await pRes.json()
        const p = j.project
        if (!p) continue
        // Done: the job flips stage to 'pricing' on success, or status to
        // 'rejected' on failure. Both leave the "running" condition.
        if (p.status === 'rejected' || p.stage !== 'processing') {
          setProject(p)
          setItems(j.items || [])
          setQuotations(j.quotations || [])
          setProcessing(false)
          setRunMessage('')
          if (p.status === 'rejected') {
            toast.error(p.ai_error || t('furn_processing_failed'), { duration: 12000 })
          } else {
            toast.success(`${(j.items || []).length} ${t('furn_items_extracted')}`)
            await loadItemSources()
            await loadItemFlags()
            setTab('pricing')
          }
          return
        }
      } catch { /* transient — next tick */ }
    }
    // Exhausted the poll budget without a terminal state — stop spinning.
    setProcessing(false)
    setRunMessage('')
    await refreshProject()
    toast.error(t('furn_processing_failed'), { duration: 10000 })
  }

  async function runProcessing() {
    setProcessing(true)
    setRunMessage('')
    const res = await fetch(`/api/furn/projects/${project.id}/process`, { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      setProcessing(false)
      toast.error(j.error || 'Processing failed')
      await refreshProject()
      return
    }
    // 202 — the router is running in the background; watch it.
    await pollUntilDone()
  }

  // Resume watching after a page reload mid-run: the server marks the project
  // in_progress+processing while the router works, so re-attach the poller
  // instead of showing a dead spinner that never resolves.
  useEffect(() => {
    if (initialProject.status === 'in_progress' && initialProject.stage === 'processing') {
      setProcessing(true)
      void pollUntilDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patchItem(id: string, patch: Partial<FurnItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
    await fetch(`/api/furn/projects/${project.id}/items/${id}`, { method: 'DELETE' })
  }

  async function deleteQuotation(qid: string) {
    if (!confirm(t('furn_quotation_delete_confirm'))) return
    const prev = quotations
    setQuotations(curr => curr.filter(q => q.id !== qid))
    const res = await fetch(`/api/furn/quotations/${qid}`, { method: 'DELETE' })
    if (!res.ok) {
      setQuotations(prev)
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Failed')
      return
    }
    toast.success(t('furn_quotation_deleted'))
  }

  async function addManualItem() {
    // Seed an editable default title — the API rejects a blank description, and
    // the intent here is to drop in a new row the user renames inline.
    const res = await fetch(`/api/furn/projects/${project.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: isRtl ? 'بند جديد' : 'New item', quantity: 1, unit: 'm' }),
    })
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return
    }
    setItems(prev => [...prev, j.item])
  }

  async function savePrices() {
    setSavingPrices(true)
    const res = await fetch(`/api/furn/projects/${project.id}/items`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map(it => ({
          id: it.id,
          description: it.description,
          details: it.details,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          notes: it.notes,
        })),
      }),
    })
    setSavingPrices(false)
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Save failed')
      return
    }
    toast.success(t('furn_save_prices'))
  }

  // One click → AR + EN quotations + both PDFs persisted to S3. Errors are
  // surfaced individually because the API will return DB rows even when a
  // single render fails (the user can retry).
  async function sendQuotation() {
    setFinalizing(true)
    await savePrices()
    const res = await fetch(`/api/furn/projects/${project.id}/finalize`, { method: 'POST' })
    const j = await res.json()
    setFinalizing(false)
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return
    }
    // Merge by id so re-issuing REPLACES the AR/EN rows instead of stacking a
    // duplicate pair on top of the old ones each time.
    setQuotations(prev => {
      const incoming: FurnQuotation[] = j.quotations || []
      const incomingIds = new Set(incoming.map(q => q.id))
      return [...incoming, ...prev.filter(q => !incomingIds.has(q.id))]
    })
    setProject(prev => ({ ...prev, stage: 'quoted', status: 'completed' }))
    setTab('quotations')

    const failures = (j.results || []).filter((r: { pdf_url: string | null }) => !r.pdf_url)
    if (failures.length > 0) {
      // Surface the real render error (not just "partial") so PDF failures are
      // diagnosable instead of silently falling back to "open print page".
      const reason = (failures[0] as { pdf_error?: string }).pdf_error
      toast.warning(reason ? `${t('furn_quotation_partial')} — ${reason}` : t('furn_quotation_partial'), { duration: 12000 })
      console.error('[furn] PDF render failures:', failures)
    } else {
      toast.success(t('furn_quotation_ready'))
    }
  }

  // Rejected review-flagged rows leave the quotation on the server (finalize /
  // quote / print all drop them), so the on-screen preview and the "all priced"
  // gate MUST drop them too — otherwise the preview total disagrees with the PDF
  // and an unpriced REJECTED row would wrongly keep the Finalize button disabled.
  const activeItems = items.filter(it => itemFlags[it.id]?.status !== 'rejected')
  const itemsSum = activeItems.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)
  // Mirror the PDF: "not included" delivery adds a shipping line into the total,
  // so the on-screen totals match what the customer will see.
  const shippingLine = deliveryChoice === 'excluded' ? Number(shippingAmount) || 0 : 0
  const subtotal = itemsSum + shippingLine
  const vat = subtotal * 0.15
  const total = subtotal + vat
  const allPriced = activeItems.length > 0 && activeItems.every(it => it.unit_price !== null && it.unit_price !== undefined)

  const fileCount =
    (project.boq_url ? 1 : 0) +
    (project.spec_files?.length || 0) +
    (project.drawing_files?.length || 0) +
    (project.other_files?.length || 0)

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <Link href="/furn" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronStart className="w-4 h-4" />
        {t('furn_back')}
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white flex items-center justify-center shadow-md flex-shrink-0">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{project.project_name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {project.company_name}
              {project.engineer_name ? ` · ${project.engineer_name}` : ''}
              {project.engineer_phone ? ` · ${project.engineer_phone}` : ''}
            </p>
            {project.subject && (
              <p className="text-xs text-muted-foreground mt-1 italic">{project.subject}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs strip */}
      <div className="flex items-center gap-1 mb-6 border-b">
        <TabButton
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={<Paperclip className="w-4 h-4" />}
          label={t('furn_tab_files')}
          count={fileCount}
        />
        <TabButton
          active={tab === 'pricing'}
          onClick={() => setTab('pricing')}
          icon={<ListChecks className="w-4 h-4" />}
          label={t('furn_tab_pricing')}
          count={items.length}
        />
        <TabButton
          active={tab === 'quotations'}
          onClick={() => setTab('quotations')}
          icon={<Send className="w-4 h-4" />}
          label={t('furn_tab_quotations')}
          count={quotations.length}
        />
      </div>

      {/* Files tab */}
      {tab === 'files' && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-500" />
              {t('furn_step1_title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FilesSection project={project} t={t} />

            {project.ai_error ? (
              <div className="p-3 rounded-lg border border-red-200 bg-red-50">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-800">{t('furn_processing_failed')}</p>
                    <p className="text-xs text-red-700/80 mt-1 whitespace-pre-wrap">{project.ai_error}</p>
                  </div>
                </div>
              </div>
            ) : processing && (
              <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-amber-600 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-amber-800">{t('furn_processing_running')}</p>
                  {/* Live router coverage — "فهرسة الملفات 34/200…". Honest
                      progress beats a spinner that could mean anything. */}
                  {runMessage && <p className="text-xs text-amber-700/80 mt-0.5">{runMessage}</p>}
                </div>
              </div>
            )}

            {project.ai_detected_departments?.length > 0 && (
              <div className="rounded-lg bg-blue-50/40 border border-blue-100 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-900">{t('furn_detected_departments')}</p>
                    <p className="text-blue-800/80 mt-0.5">{project.ai_detected_departments.join(' · ')}</p>
                    {project.ai_summary && <p className="text-xs text-blue-800/70 mt-1 italic">{project.ai_summary}</p>}
                  </div>
                </div>
              </div>
            )}

            <Button onClick={runProcessing} disabled={processing} size="lg" className="bg-orange-600 hover:bg-orange-700 text-white">
              {processing
                ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_processing_running')}</>
                : <>
                    <Sparkles className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
                    {items.length > 0 || project.ai_error ? t('furn_processing_retry') : t('furn_step1_title')}
                  </>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Pricing tab */}
      {tab === 'pricing' && (
        <>
          <Card className="border-0 shadow-sm mb-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">{t('furn_extracted_items')}</CardTitle>
              <div className="flex items-center gap-2">
                <Button onClick={runProcessing} disabled={processing} variant="outline" size="sm">
                  {processing
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><RefreshCw className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />{t('furn_processing_retry')}</>}
                </Button>
                {canEditPrices && (
                  <Button onClick={addManualItem} variant="outline" size="sm">
                    <Plus className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />
                    Item
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">{t('furn_no_items')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground w-12">#</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('furn_item_description')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground w-24">{t('furn_item_quantity')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground w-20">{t('furn_item_unit')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground w-32">{t('furn_item_price')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground w-28">{t('furn_item_total')}</th>
                        <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('furn_item_notes')}</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((it, idx) => {
                        const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
                        // qty=0 rows come from the AI when it located the
                        // item but couldn't resolve the quantity (BOQ said
                        // "see X.pdf" and the file wasn't attached, or the
                        // qty cell was blank). Tint the whole row amber so
                        // the pricer can't miss that it needs a manual fix
                        // before the line is real.
                        const needsReview = Number(it.quantity) === 0
                        const flag = itemFlags[it.id]
                        // Section header: render once when the sheet changes.
                        const sec = itemSections[it.id] || ''
                        const prevSec = idx > 0 ? (itemSections[items[idx - 1].id] || '') : ''
                        const showSection = sec && sec !== prevSec
                        // Red = likely mistake / not our department (call the
                        // customer). Amber = doubtful/duplicate/no-qty. Rejected
                        // rows dim out but are never deleted.
                        const rowClass =
                          flag?.status === 'rejected' ? 'bg-gray-100 opacity-60'
                          : flag && flag.status === 'pending' ? (flag.red ? 'bg-red-50' : 'bg-amber-50/70')
                          : needsReview ? 'bg-amber-50/60' : undefined
                        return (
                          <Fragment key={it.id}>
                          {showSection && (
                            <tr className="bg-gray-100/80">
                              <td colSpan={8} className="px-3 py-1.5 text-xs font-bold text-gray-700">📑 {sec}</td>
                            </tr>
                          )}
                          <tr className={rowClass}>
                            <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                            {/* Description cell — short title on top in the
                                normal table font, longer details under it in
                                a smaller muted line. Both editable so the
                                team can clean up anything the AI got wrong. */}
                            <td className="px-3 py-2 space-y-1">
                              <Input
                                value={it.description}
                                onChange={e => patchItem(it.id, { description: e.target.value })}
                                disabled={!canEditPrices}
                                className="h-8 text-xs font-medium"
                                placeholder={t('furn_item_description')}
                              />
                              <Textarea
                                value={it.details || ''}
                                onChange={e => patchItem(it.id, { details: e.target.value })}
                                disabled={!canEditPrices}
                                rows={2}
                                className="text-[11px] leading-snug text-muted-foreground resize-y min-h-[2.25rem] py-1"
                                placeholder={t('furn_item_details')}
                              />
                              {itemSources[it.id] && (
                                <p className="text-[11px] text-muted-foreground/80 mt-1" title={isRtl ? 'المصدر (داخلي)' : 'Source (internal)'}>📄 {itemSources[it.id]}</p>
                              )}
                              {flag && (
                                <div className={`mt-1 rounded-md border p-1.5 text-[11px] ${flag.red ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                                  <div className="flex items-start gap-1">
                                    <span>⚠️</span>
                                    <span className="flex-1">{flag.reason}{flag.red ? (isRtl ? ' — راجع مع العميل' : ' — check with customer') : ''}</span>
                                  </div>
                                  {canEditPrices && (
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <button type="button" onClick={() => setFlagStatus(it.id, 'approved')}
                                        className={`px-2 py-0.5 rounded border ${flag.status === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
                                        {flag.status === 'approved' ? (isRtl ? '✓ معتمد' : '✓ approved') : (isRtl ? 'اعتماد' : 'approve')}
                                      </button>
                                      <button type="button" onClick={() => setFlagStatus(it.id, 'rejected')}
                                        className={`px-2 py-0.5 rounded border ${flag.status === 'rejected' ? 'bg-red-600 text-white border-red-600' : 'bg-white hover:bg-red-50 border-red-300 text-red-700'}`}>
                                        {flag.status === 'rejected' ? (isRtl ? '✗ مرفوض' : '✗ rejected') : (isRtl ? 'رفض' : 'reject')}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number" min={0} step={0.01}
                                value={it.quantity}
                                onChange={e => patchItem(it.id, { quantity: Number(e.target.value) })}
                                disabled={!canEditPrices}
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={it.unit}
                                onChange={e => patchItem(it.id, { unit: e.target.value })}
                                disabled={!canEditPrices}
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number" min={0} step={0.01}
                                value={it.unit_price ?? ''}
                                onChange={e => patchItem(it.id, { unit_price: e.target.value === '' ? null : Number(e.target.value) })}
                                disabled={!canEditPrices}
                                placeholder="—"
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-foreground tabular-nums">
                              {it.unit_price !== null && it.unit_price !== undefined ? lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                value={it.notes || ''}
                                onChange={e => patchItem(it.id, { notes: e.target.value })}
                                disabled={!canEditPrices}
                                className="h-8 text-xs"
                              />
                            </td>
                            <td className="px-2">
                              {canEditPrices && (
                                <Button variant="ghost" size="sm" onClick={() => deleteItem(it.id)} className="text-red-600 hover:bg-red-50 h-8 w-8 p-0">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </td>
                          </tr>
                          </Fragment>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t">
                      {shippingLine > 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-2 text-end font-medium">{isRtl ? 'التوصيل' : 'Delivery'}</td>
                          <td className="px-3 py-2 tabular-nums">{shippingLine.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td colSpan={2}></td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={5} className="px-3 py-2 text-end font-medium">{t('furn_subtotal')}</td>
                        <td className="px-3 py-2 font-bold tabular-nums">{subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td colSpan={2}></td>
                      </tr>
                      <tr>
                        <td colSpan={5} className="px-3 py-2 text-end font-medium">{t('furn_vat')}</td>
                        <td className="px-3 py-2 font-bold tabular-nums">{vat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td colSpan={2}></td>
                      </tr>
                      <tr>
                        <td colSpan={5} className="px-3 py-2 text-end font-medium">{t('furn_grand_total')}</td>
                        <td className="px-3 py-2 font-bold tabular-nums text-orange-700">{total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {canExport && (
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <span className="text-muted-foreground">{isRtl ? 'التوصيل في العرض:' : 'Delivery on quote:'}</span>
              {([
                { v: 'included' as const, ar: 'شامل', en: 'Included' },
                { v: 'excluded' as const, ar: 'غير شامل', en: 'Not included' },
                { v: 'none' as const, ar: 'بدون', en: 'None' },
              ]).map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => changeDelivery(opt.v)}
                  className={[
                    'px-3 py-1 rounded-full border transition-colors',
                    deliveryChoice === opt.v
                      ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30'
                      : 'border-border hover:bg-muted',
                  ].join(' ')}
                >
                  {isRtl ? opt.ar : opt.en}
                </button>
              ))}
              {/* When not included, the shipping price becomes a line item added
                  to the quotation total. */}
              {deliveryChoice === 'excluded' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-muted-foreground">{isRtl ? 'سعر الشحن:' : 'Shipping:'}</span>
                  <Input
                    type="number" min={0} step="any" inputMode="decimal"
                    value={shippingAmount || ''}
                    placeholder="0.00"
                    onChange={e => setShippingAmount(Number(e.target.value) || 0)}
                    onBlur={() => saveDelivery('excluded', shippingAmount)}
                    className="h-8 w-28 tabular-nums"
                  />
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {canEditPrices && (
              <Button onClick={savePrices} disabled={savingPrices} variant="outline">
                {savingPrices
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : t('furn_save_prices')}
              </Button>
            )}
            {canExport && (
              <Button
                onClick={() => { sendQuotation() }}
                disabled={finalizing || !allPriced}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {finalizing
                  ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_quotation_generating')}</>
                  : <><Send className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_send_quotation')}</>}
              </Button>
            )}
          </div>
        </>
      )}

      {/* Quotations tab */}
      {tab === 'quotations' && (
        <div className="space-y-4">
          {canExport && (
            <Card className="border-0 shadow-sm"><CardContent className="p-3">
              <QuoteTermsControl scopeKey={`furn:${project.id}`} uiAr={isRtl} quoteLang="ar" />
            </CardContent></Card>
          )}
          {/* Send action — only shown until the first quotation lands.
              After that, the history list below is the primary UI; the
              user re-sends from the small "Re-issue" button at the top
              of the history card instead of a giant CTA card. */}
          {canExport && quotations.length === 0 && (
            <Card className="border-0 shadow-sm border-orange-200 bg-gradient-to-br from-orange-50/60 to-amber-50/40">
              <CardContent className="py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center flex-shrink-0">
                    <Send className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t('furn_send_quotation')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('furn_send_quotation_hint')}</p>
                  </div>
                </div>
                <Button
                  onClick={() => sendQuotation()}
                  disabled={finalizing || !allPriced}
                  size="lg"
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  {finalizing
                    ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_quotation_generating')}</>
                    : <><Send className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_send_quotation')}</>}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Email the finished PDF straight to the client — recipient + subject
              come from the linked project; language picks which PDF + message. */}
          {canExport && quotations.length > 0 && (
            <Card className="border-0 shadow-sm border-blue-200 bg-blue-50/40">
              <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 flex-shrink-0">
                  <Send className="w-4 h-4" /> {isRtl ? 'أرسل العرض للعميل' : 'Email to client'}
                </div>
                <div className="inline-flex rounded-lg border bg-white p-0.5 text-xs">
                  {(['ar', 'en'] as const).map((l) => (
                    <button key={l} type="button" onClick={() => setEmailLang(l)}
                      className={`px-3 py-1 rounded-md ${emailLang === l ? 'bg-blue-600 text-white' : 'text-muted-foreground'}`}>
                      {l === 'ar' ? 'عربي' : 'EN'}
                    </button>
                  ))}
                </div>
                <input
                  type="email" dir="ltr" value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
                  placeholder={isRtl ? 'إيميل العميل (أو اتركه ليُسحب من المشروع)' : 'Client email (or leave to pull from project)'}
                  className="h-9 flex-1 min-w-[180px] rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                />
                <Button onClick={emailQuotation} disabled={emailingQuote} className="gap-2">
                  {emailingQuote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {isRtl ? 'إرسال' : 'Send'}
                </Button>
              </CardContent>
            </Card>
          )}

          {quotations.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-12 text-center text-sm text-muted-foreground">
                <Send className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                {t('furn_no_quotations_yet')}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base font-semibold">{t('furn_quotations_history')}</CardTitle>
                {canExport && (
                  <Button
                    onClick={() => sendQuotation()}
                    disabled={finalizing || !allPriced}
                    variant="outline"
                    size="sm"
                  >
                    {finalizing
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <><RefreshCw className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />{t('furn_reissue')}</>}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {quotations.map(q => (
                  <QuotationRow
                    key={q.id}
                    q={q}
                    projectId={project.id}
                    onDelete={canExport ? deleteQuotation : undefined}
                    t={t}
                    isRtl={isRtl}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, label, count }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
        active
          ? 'border-orange-500 text-orange-700'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
      }`}
    >
      {icon}
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
          active ? 'bg-orange-100 text-orange-700' : 'bg-muted/60 text-muted-foreground'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function FilesSection({ project, t }: { project: FurnProject; t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string }) {
  return (
    <div className="space-y-3">
      <FilesGroup
        title={t('furn_form_boq')}
        icon={<FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
        files={project.boq_url ? [{ url: project.boq_url, name: project.boq_filename || 'BOQ' }] : []}
      />
      <FilesGroup
        title={t('furn_form_specs')}
        icon={<FileTextIcon className="w-4 h-4 text-blue-600" />}
        files={project.spec_files || []}
      />
      <FilesGroup
        title={t('furn_form_drawings')}
        icon={<ImageIcon className="w-4 h-4 text-purple-600" />}
        files={project.drawing_files || []}
      />
      <FilesGroup
        title={t('furn_form_other')}
        icon={<Paperclip className="w-4 h-4 text-amber-600" />}
        files={project.other_files || []}
      />
    </div>
  )
}

function FilesGroup({ title, icon, files }: {
  title: string
  icon: React.ReactNode
  files: Array<{ url: string; name: string }>
}) {
  if (files.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        {icon}
        {title}
        <span className="text-[10px] bg-muted/60 px-1 rounded">{files.length}</span>
      </p>
      <div className="space-y-1.5">
        {files.map((f, i) => (
          <a
            key={`${f.url}-${i}`}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded border bg-muted/30 hover:bg-muted/60 transition text-sm"
          >
            <FileTextIcon className="w-4 h-4 text-muted-foreground" />
            <span className="truncate flex-1">{f.name}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

function QuotationRow({ q, projectId, onDelete, t, isRtl }: {
  q: FurnQuotation
  projectId: string
  onDelete?: (id: string) => void
  t: (k: Parameters<ReturnType<typeof useLanguage>['t']>[0]) => string
  isRtl: boolean
}) {
  const langLabel = q.language === 'ar' ? t('furn_lang_ar') : t('furn_lang_en')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded border bg-muted/30">
      <div className="flex flex-wrap items-center gap-3 min-w-0">
        <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-xs font-bold tabular-nums">
          #{q.quotation_number}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
          q.language === 'ar' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
        }`}>
          {langLabel}
        </span>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {new Date(q.generated_at).toLocaleString('en-GB')}
        </span>
        <span className="text-sm font-medium tabular-nums">
          {Number(q.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {/* Always show a working button. If S3 has the rendered PDF, deliver
            that; otherwise route to the live print page which renders the
            same quotation on demand. Both paths produce a printable PDF —
            the difference is invisible to the user, so we drop the
            "PDF missing" warning UI. */}
        {q.pdf_url ? (
          <a
            href={q.pdf_url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs font-medium border bg-background hover:bg-muted transition"
          >
            <FileDown className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />
            {t('furn_download_pdf')}
          </a>
        ) : (
          <a
            href={`/print/quotation/${projectId}/${q.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-xs font-medium border bg-background hover:bg-muted transition"
          >
            <FileDown className={`w-3.5 h-3.5 ${isRtl ? 'ml-1' : 'mr-1'}`} />
            {t('furn_download_pdf')}
          </a>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(q.id)}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-red-600 hover:bg-red-50 transition"
            title={t('furn_quotation_delete_confirm')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
