'use client'

// "الفرص" — the scouting board.
//
// Reads from GET /api/opportunities. Polls ONLY while a scan is running (the
// data can't change otherwise), so an idle tab costs nothing — same reasoning
// as the rest of the feature: light by default.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Radar, Building2, Landmark, Hotel, Crown, Mail, Phone, Globe, ExternalLink,
  RefreshCw, Loader2, Trash2, MapPin, CalendarDays, AlertCircle, Search, Copy,
  CheckCircle2, Archive, FileDown, Briefcase,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Pagination, usePagination } from '@/components/ui/pagination'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STATUSES,
  categoryLabel,
  stageLabel,
  statusLabel,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityStatus,
  type ScanRun,
} from '@/lib/opportunities/types'

interface Props {
  initialItems: Opportunity[]
  initialLastRun: ScanRun | null
}

// 'all' + the sectors = the working list. 'contacted'/'archived' are where rows
// go to stop cluttering it.
type TabKey = 'all' | OpportunityCategory | 'contacted' | 'archived'

// A row is "still work" until someone has actually called them.
const ACTIVE_STATUSES: OpportunityStatus[] = ['new', 'saved']

const CATEGORY_ICON: Record<OpportunityCategory, LucideIcon> = {
  government: Landmark,
  developers: Building2,
  commercial: Hotel,
  landmark: Crown,
}

// One accent per sector so the tabs and the cards read as the same system.
const CATEGORY_ACCENT: Record<OpportunityCategory, string> = {
  government: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  developers: 'bg-blue-50 text-blue-700 border-blue-200',
  commercial: 'bg-amber-50 text-amber-700 border-amber-200',
  landmark: 'bg-purple-50 text-purple-700 border-purple-200',
}

const STATUS_ACCENT: Record<OpportunityStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  saved: 'bg-purple-50 text-purple-700 border-purple-200',
  contacted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-gray-100 text-gray-600 border-gray-200',
}

function scoreAccent(score: number): string {
  if (score >= 80) return 'bg-emerald-500 text-white'
  if (score >= 50) return 'bg-amber-500 text-white'
  return 'bg-gray-400 text-white'
}

function formatDateTime(iso: string | null, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDate(iso: string | null, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' })
}

export function OpportunitiesClient({ initialItems, initialLastRun }: Props) {
  const { t, lang, isRtl } = useLanguage()
  const router = useRouter()

  const [items, setItems] = useState<Opportunity[]>(initialItems)
  const [lastRun, setLastRun] = useState<ScanRun | null>(initialLastRun)
  // The workflow tabs ARE the status split now: the sector tabs show only what
  // you still have to work (new/saved), and anything you've called moves to its
  // own tab. Otherwise the working list just grows into an archive you scroll
  // past every morning.
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [cityFilter, setCityFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '7' | '30' | '90'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [starting, setStarting] = useState(false)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [huntingId, setHuntingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)

  const isScanning = lastRun?.status === 'running'

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/opportunities')
      if (!res.ok) return
      const j = await res.json()
      if (Array.isArray(j.items)) setItems(j.items)
      setLastRun(j.lastRun ?? null)
    } catch {
      /* transient — the next poll will pick it up */
    }
  }, [])

  // Poll only while the robot is actually working.
  useEffect(() => {
    if (!isScanning) return
    const id = setInterval(refetch, 5000)
    return () => clearInterval(id)
  }, [isScanning, refetch])

  // Announce the outcome once, on the running → finished edge.
  const wasScanning = useRef(isScanning)
  useEffect(() => {
    if (wasScanning.current && !isScanning && lastRun) {
      if (lastRun.status === 'done') {
        toast.success(`${t('opp_scan_done')} — ${lastRun.added} ${t('opp_new_found')}`)
      } else if (lastRun.status === 'failed') {
        toast.error(`${t('opp_scan_failed')}: ${lastRun.error || ''}`, { duration: 12000 })
      }
    }
    wasScanning.current = isScanning
  }, [isScanning, lastRun, t])

  async function startScan() {
    setStarting(true)
    try {
      const res = await fetch('/api/opportunities/scan', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('opp_scan_failed'))
        return
      }
      toast.success(t('opp_scan_started'))
      await refetch()
    } catch {
      toast.error(t('opp_scan_failed'))
    } finally {
      setStarting(false)
    }
  }

  async function setStatus(id: string, status: OpportunityStatus) {
    setBusyId(id)
    const prev = items
    setItems((list) => list.map((o) => (o.id === id ? { ...o, status } : o)))
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      toast.success(t('opp_status_updated'))
    } catch {
      setItems(prev)
      toast.error(t('opp_scan_failed'))
    } finally {
      setBusyId(null)
    }
  }

  async function saveNote(id: string) {
    const notes = noteDrafts[id] ?? ''
    setBusyId(id)
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error()
      setItems((list) => list.map((o) => (o.id === id ? { ...o, notes } : o)))
      setNoteDrafts((d) => {
        const next = { ...d }
        delete next[id]
        return next
      })
      toast.success(t('opp_saved'))
    } catch {
      toast.error(t('opp_scan_failed'))
    } finally {
      setBusyId(null)
    }
  }

  // The dedicated contact hunt. Awaited (not polled) because it's one short
  // search and the user is watching this specific card.
  async function findContacts(id: string) {
    setHuntingId(id)
    try {
      const res = await fetch(`/api/opportunities/${id}/contacts`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('opp_scan_failed'), { duration: 10000 })
        return
      }
      if (j.item) setItems((list) => list.map((o) => (o.id === id ? j.item : o)))
      if (j.found > 0) toast.success(`${j.found} ${t('opp_contacts_found')}`)
      else toast.info(t('opp_contacts_none_found'))
    } catch {
      toast.error(t('opp_scan_failed'))
    } finally {
      setHuntingId(null)
    }
  }

  // Lead → client project. From there /furn's import card can pull it into a
  // quotation, which is how a scouted row eventually turns into money.
  async function convertToProject(id: string) {
    setConvertingId(id)
    try {
      const res = await fetch(`/api/opportunities/${id}/convert`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('opp_scan_failed'), { duration: 10000 })
        return
      }
      // The server also flips it to 'contacted' so it leaves the working list.
      setItems((list) => list.map((o) => (o.id === id ? { ...o, status: 'contacted' as const } : o)))
      toast.success(t('opp_converted'))
      if (j.project?.id) router.push(`/projects/${j.project.id}`)
    } catch {
      toast.error(t('opp_scan_failed'))
    } finally {
      setConvertingId(null)
    }
  }

  async function remove(id: string) {
    if (!confirm(t('opp_delete_confirm'))) return
    const prev = items
    setItems((list) => list.filter((o) => o.id !== id))
    try {
      const res = await fetch(`/api/opportunities/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(t('opp_deleted'))
    } catch {
      setItems(prev)
      toast.error(t('opp_scan_failed'))
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('opp_copied'))
    } catch {
      /* clipboard blocked — not worth an error toast */
    }
  }

  // Every city we've actually scouted, so the dropdown only ever offers filters
  // that can return something.
  const cities = useMemo(
    () => Array.from(new Set(items.map((o) => o.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar')),
    [items],
  )

  // City/date/text filters first, so the tab counts reflect what you'd actually
  // see if you clicked the tab.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoff = dateFilter === 'all' ? 0 : Date.now() - Number(dateFilter) * 24 * 60 * 60 * 1000
    return items.filter((o) => {
      if (cityFilter !== 'all' && o.city !== cityFilter) return false
      if (cutoff) {
        // Fall back to when we scouted it when the article carried no date —
        // otherwise undated finds would silently vanish from every date filter.
        const when = new Date(o.publishedAt || o.createdAt).getTime()
        if (Number.isNaN(when) || when < cutoff) return false
      }
      if (!q) return true
      return [o.title, o.owner, o.city, o.summary, o.relevance, o.targeting]
        .some((f) => (f || '').toLowerCase().includes(q))
    })
  }, [items, cityFilter, dateFilter, search])

  const active = useMemo(() => base.filter((o) => ACTIVE_STATUSES.includes(o.status)), [base])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: active.length }
    for (const c of OPPORTUNITY_CATEGORIES) m[c.key] = active.filter((o) => o.category === c.key).length
    m.contacted = base.filter((o) => o.status === 'contacted').length
    m.archived = base.filter((o) => o.status === 'archived').length
    return m
  }, [base, active])

  const filtered = useMemo(() => {
    if (activeTab === 'contacted') return base.filter((o) => o.status === 'contacted')
    if (activeTab === 'archived') return base.filter((o) => o.status === 'archived')
    if (activeTab === 'all') return active
    return active.filter((o) => o.category === activeTab)
  }, [base, active, activeTab])

  // 12 cards is about a screen and a half. Without this the page renders every
  // row it has ever scouted — fine at 13, painful at the 200+ this accumulates
  // into within a month.
  const paged = usePagination({ items: filtered, perPage: 12, page })
  useEffect(() => { setPage(1) }, [activeTab, cityFilter, dateFilter, search])

  // Excel, because that is where a sales team actually lives. Exports what's on
  // screen (current tab + filters), not the whole store — if you filtered to
  // Riyadh, you want the Riyadh list.
  async function exportExcel() {
    if (filtered.length === 0) {
      toast.error(t('opp_nothing_to_export'))
      return
    }
    // Lazy-loaded: xlsx is heavy and most visits never export.
    const XLSX = await import('xlsx')
    const rows = filtered.map((o) => ({
      [t('opp_priority')]: o.score,
      [t('opp_title')]: o.title,
      [t('opp_owner')]: o.owner,
      'التصنيف': categoryLabel(o.category, lang),
      'المرحلة': stageLabel(o.stage, lang),
      'المدينة': o.city,
      'التاريخ': o.publishedAt || '',
      'الحالة': statusLabel(o.status, lang),
      [t('opp_relevance')]: o.relevance,
      [t('opp_targeting')]: o.targeting,
      'إيميلات': o.contacts.map((c) => c.email).filter(Boolean).join(' | '),
      'أرقام': o.contacts.map((c) => c.phone).filter(Boolean).join(' | '),
      'المصادر': o.sourceUrls.join(' | '),
      [t('opp_notes')]: o.notes,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'الفرص')
    XLSX.writeFile(wb, `kaaseb-opportunities-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(t('opp_exported'))
  }

  const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
    { key: 'all', label: t('opp_all'), icon: Radar },
    ...OPPORTUNITY_CATEGORIES.map((c) => ({
      key: c.key as TabKey,
      label: c[lang],
      icon: CATEGORY_ICON[c.key],
    })),
    { key: 'contacted', label: t('opp_tab_contacted'), icon: CheckCircle2 },
    { key: 'archived', label: t('opp_tab_archived'), icon: Archive },
  ]

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-md flex-shrink-0">
            <Radar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('opp_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('opp_subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="gap-2">
            <FileDown className="w-4 h-4" />
            {t('opp_export')}
          </Button>
          <Button onClick={startScan} disabled={isScanning || starting} className="gap-2">
            {isScanning || starting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('opp_scanning')}
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                {t('opp_refresh')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Last-run strip */}
      <Card className="mb-4 border-0 shadow-sm">
        <CardContent className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {isScanning ? (
            <span className="flex items-center gap-2 text-emerald-700 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('opp_scanning')}
            </span>
          ) : lastRun?.status === 'failed' ? (
            <span className="flex items-center gap-2 text-red-600 font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {t('opp_scan_failed')}: {lastRun.error}
            </span>
          ) : lastRun?.finishedAt ? (
            <>
              <span className="text-muted-foreground">
                {t('opp_last_scan')}: <span className="text-gray-900 font-medium">{formatDateTime(lastRun.finishedAt, lang)}</span>
              </span>
              <span className="text-muted-foreground">
                +{lastRun.added} {t('opp_new_found')}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('opp_never_scanned')}</span>
          )}
          <span className="text-muted-foreground ms-auto">{items.length} {t('opp_title')}</span>
        </CardContent>
      </Card>

      {/* Sector tabs */}
      <div className="mb-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        <div className="inline-flex gap-2 min-w-max">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === key
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-bold',
                  activeTab === key ? 'bg-white/20 text-white' : 'bg-white text-gray-500',
                )}
              >
                {counts[key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="py-3 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[150px]">
            <Search className={cn('absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground', isRtl ? 'right-3' : 'left-3')} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('opp_search_placeholder')}
              className={isRtl ? 'pr-10' : 'pl-10'}
            />
          </div>
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">{t('opp_all_cities')}</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as 'all' | '7' | '30' | '90')}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">{t('opp_all_dates')}</option>
            <option value="7">{t('opp_last_week')}</option>
            <option value="30">{t('opp_last_month')}</option>
            <option value="90">{t('opp_last_3months')}</option>
          </select>
        </CardContent>
      </Card>

      {/* Cards */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Radar className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-medium text-gray-900">
              {items.length === 0 ? t('opp_empty') : t('opp_no_results')}
            </p>
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t('opp_empty_hint')}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {paged.slice.map((o) => {
            const Icon = CATEGORY_ICON[o.category]
            const draft = noteDrafts[o.id]
            const dirty = draft !== undefined && draft !== o.notes
            return (
              <Card key={o.id} className="flex flex-col">
                <CardContent className="p-4 flex flex-col gap-3 flex-1">
                  {/* Title row */}
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'w-11 h-11 rounded-lg flex flex-col items-center justify-center font-bold text-sm flex-shrink-0',
                        scoreAccent(o.score),
                      )}
                      title={`${t('opp_priority')}: ${o.score}/100`}
                    >
                      {o.score}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 leading-snug">{o.title}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border', CATEGORY_ACCENT[o.category])}>
                          <Icon className="w-3 h-3" />
                          {categoryLabel(o.category, lang)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs border bg-gray-50 text-gray-600 border-gray-200">
                          {stageLabel(o.stage, lang)}
                        </span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs border', STATUS_ACCENT[o.status])}>
                          {statusLabel(o.status, lang)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {o.owner && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5" />
                        {t('opp_owner')}: <span className="text-gray-700 font-medium">{o.owner}</span>
                      </span>
                    )}
                    {o.city && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {o.city}
                      </span>
                    )}
                    {o.publishedAt && (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5" />
                        {formatDate(o.publishedAt, lang)}
                      </span>
                    )}
                  </div>

                  {o.summary && <p className="text-sm text-gray-600 leading-relaxed">{o.summary}</p>}

                  {o.relevance && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
                      <p className="text-xs font-semibold text-emerald-800 mb-0.5">{t('opp_relevance')}</p>
                      <p className="text-sm text-emerald-900/90 leading-relaxed">{o.relevance}</p>
                    </div>
                  )}

                  {o.targeting && (
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
                      <p className="text-xs font-semibold text-blue-800 mb-0.5">{t('opp_targeting')}</p>
                      <p className="text-sm text-blue-900/90 leading-relaxed whitespace-pre-line">{o.targeting}</p>
                    </div>
                  )}

                  {/* Contacts */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-gray-700">{t('opp_contacts')}</p>
                      {/* The hunt is on-demand: most rows are never chased, so
                          paying to find a number for all of them is waste. */}
                      {o.owner && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => findContacts(o.id)}
                          disabled={huntingId === o.id}
                          className="gap-1.5 h-7"
                        >
                          {huntingId === o.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {t('opp_finding_contacts')}
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3" />
                              {o.contactsFetchedAt ? t('opp_contacts_retry') : t('opp_find_contacts')}
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    {o.contacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {o.contactsFetchedAt ? t('opp_contacts_none_found') : t('opp_no_contacts')}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {o.contacts.map((c, i) => (
                          <div key={i} className="rounded-md bg-gray-50 border border-gray-100 p-2 text-xs">
                            {(c.name || c.role) && (
                              <p className="font-medium text-gray-800">
                                {c.name}{c.name && c.role ? ' — ' : ''}{c.role}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              {c.email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-muted-foreground" />
                                  <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline break-all">{c.email}</a>
                                  <button onClick={() => copy(c.email)} className="text-muted-foreground hover:text-gray-700" aria-label={t('opp_copied')}>
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </span>
                              )}
                              {c.phone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-muted-foreground" />
                                  <a href={`tel:${c.phone}`} className="text-blue-600 hover:underline" dir="ltr">{c.phone}</a>
                                  <button onClick={() => copy(c.phone)} className="text-muted-foreground hover:text-gray-700" aria-label={t('opp_copied')}>
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </span>
                              )}
                              {c.website && (
                                <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                  <Globe className="w-3 h-3" />
                                  {t('opp_sources')}
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sources */}
                  {o.sourceUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {o.sourceUrls.map((u, i) => (
                        <a
                          key={i}
                          href={u}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {t('opp_sources')} {i + 1}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  <div className="mt-auto pt-2">
                    <p className="text-xs font-semibold text-gray-700 mb-1">{t('opp_notes')}</p>
                    <textarea
                      value={draft ?? o.notes}
                      onChange={(e) => setNoteDrafts((d) => ({ ...d, [o.id]: e.target.value }))}
                      placeholder={t('opp_notes_placeholder')}
                      rows={2}
                      className="w-full rounded-md border border-input bg-transparent p-2 text-sm resize-y"
                    />
                    {dirty && (
                      <Button size="sm" onClick={() => saveNote(o.id)} disabled={busyId === o.id} className="mt-1.5 gap-1.5">
                        {busyId === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {t('opp_save')}
                      </Button>
                    )}
                  </div>

                  {/* Actions — wrap on narrow phones so nothing overflows */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => convertToProject(o.id)}
                      disabled={convertingId === o.id}
                      className="gap-1.5 h-8"
                    >
                      {convertingId === o.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Briefcase className="w-3.5 h-3.5" />
                      )}
                      {t('opp_to_project')}
                    </Button>
                    <select
                      value={o.status}
                      onChange={(e) => setStatus(o.id, e.target.value as OpportunityStatus)}
                      disabled={busyId === o.id}
                      className="h-8 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      {OPPORTUNITY_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>{s[lang]}</option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(o.id)}
                      aria-label={t('opp_delete_confirm')}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {paged.pageCount > 1 && (
        <div className="mt-4">
          <Pagination
            page={paged.safePage}
            pageCount={paged.pageCount}
            total={paged.total}
            perPage={12}
            onChange={setPage}
            isRtl={isRtl}
          />
        </div>
      )}
    </div>
  )
}
