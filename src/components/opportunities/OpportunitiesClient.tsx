'use client'

// "الفرص" — the scouting board.
//
// Reads from GET /api/opportunities. Polls ONLY while a scan is running (the
// data can't change otherwise), so an idle tab costs nothing — same reasoning
// as the rest of the feature: light by default.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Radar, Building2, Landmark, Hotel, Crown, Mail, Phone, Globe, ExternalLink,
  RefreshCw, Loader2, Trash2, MapPin, CalendarDays, AlertCircle, Search, Copy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

  const [items, setItems] = useState<Opportunity[]>(initialItems)
  const [lastRun, setLastRun] = useState<ScanRun | null>(initialLastRun)
  const [activeTab, setActiveTab] = useState<'all' | OpportunityCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | OpportunityStatus>('all')
  const [search, setSearch] = useState('')
  const [starting, setStarting] = useState(false)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

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

  // Status + text filter first, so the tab counts reflect what you'd actually
  // see if you clicked the tab.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (!q) return true
      return [o.title, o.owner, o.city, o.summary, o.relevance, o.targeting]
        .some((f) => (f || '').toLowerCase().includes(q))
    })
  }, [items, statusFilter, search])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: base.length }
    for (const c of OPPORTUNITY_CATEGORIES) m[c.key] = base.filter((o) => o.category === c.key).length
    return m
  }, [base])

  const filtered = useMemo(
    () => (activeTab === 'all' ? base : base.filter((o) => o.category === activeTab)),
    [base, activeTab],
  )

  const tabs: Array<{ key: 'all' | OpportunityCategory; label: string; icon: LucideIcon }> = [
    { key: 'all', label: t('opp_all'), icon: Radar },
    ...OPPORTUNITY_CATEGORIES.map((c) => ({
      key: c.key as OpportunityCategory,
      label: c[lang],
      icon: CATEGORY_ICON[c.key],
    })),
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
          <div className="relative flex-1 min-w-[220px]">
            <Search className={cn('absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground', isRtl ? 'right-3' : 'left-3')} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('opp_search_placeholder')}
              className={isRtl ? 'pr-10' : 'pl-10'}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | OpportunityStatus)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">{t('opp_all_statuses')}</option>
            {OPPORTUNITY_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s[lang]}</option>
            ))}
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
          {filtered.map((o) => {
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
                    <p className="text-xs font-semibold text-gray-700 mb-1.5">{t('opp_contacts')}</p>
                    {o.contacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('opp_no_contacts')}</p>
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

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <select
                      value={o.status}
                      onChange={(e) => setStatus(o.id, e.target.value as OpportunityStatus)}
                      disabled={busyId === o.id}
                      className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
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
    </div>
  )
}
