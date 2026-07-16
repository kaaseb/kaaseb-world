'use client'

// "شركات مستهدفة" — the account board.
// Same shape as OpportunitiesClient (tabs, cards, poll-only-while-scanning),
// tuned for companies: size filter instead of date, projects as the proof line.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Building, HardHat, Paintbrush, Landmark, Compass, Mail, Phone, Globe,
  ExternalLink, RefreshCw, Loader2, Trash2, MapPin, AlertCircle, Search, Copy,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  COMPANY_CATEGORIES,
  COMPANY_STATUSES,
  COMPANY_SIZES,
  companyCategoryLabel,
  companySizeLabel,
  companyStatusLabel,
  type TargetCompany,
  type CompanyCategory,
  type CompanyStatus,
  type CompanySize,
  type CompanyScanRun,
} from '@/lib/companies/types'

interface Props {
  initialItems: TargetCompany[]
  initialLastRun: CompanyScanRun | null
}

const CATEGORY_ICON: Record<CompanyCategory, LucideIcon> = {
  contractors: HardHat,
  finishing: Paintbrush,
  developers: Landmark,
  consultants: Compass,
}

const CATEGORY_ACCENT: Record<CompanyCategory, string> = {
  contractors: 'bg-amber-50 text-amber-700 border-amber-200',
  finishing: 'bg-purple-50 text-purple-700 border-purple-200',
  developers: 'bg-blue-50 text-blue-700 border-blue-200',
  consultants: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const STATUS_ACCENT: Record<CompanyStatus, string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  saved: 'bg-purple-50 text-purple-700 border-purple-200',
  contacted: 'bg-amber-50 text-amber-700 border-amber-200',
  client: 'bg-emerald-50 text-emerald-700 border-emerald-200',
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
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function CompaniesClient({ initialItems, initialLastRun }: Props) {
  const { t, lang, isRtl } = useLanguage()

  const [items, setItems] = useState<TargetCompany[]>(initialItems)
  const [lastRun, setLastRun] = useState<CompanyScanRun | null>(initialLastRun)
  const [activeTab, setActiveTab] = useState<'all' | CompanyCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | CompanyStatus>('all')
  const [sizeFilter, setSizeFilter] = useState<'all' | CompanySize>('all')
  const [cityFilter, setCityFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [starting, setStarting] = useState(false)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [huntingId, setHuntingId] = useState<string | null>(null)

  const isScanning = lastRun?.status === 'running'

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/companies')
      if (!res.ok) return
      const j = await res.json()
      if (Array.isArray(j.items)) setItems(j.items)
      setLastRun(j.lastRun ?? null)
    } catch {
      /* transient — the next poll picks it up */
    }
  }, [])

  useEffect(() => {
    if (!isScanning) return
    const id = setInterval(refetch, 5000)
    return () => clearInterval(id)
  }, [isScanning, refetch])

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
      const res = await fetch('/api/companies/scan', { method: 'POST' })
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

  async function findContacts(id: string) {
    setHuntingId(id)
    try {
      const res = await fetch(`/api/companies/${id}/contacts`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || t('opp_scan_failed'), { duration: 10000 })
        return
      }
      if (j.item) setItems((list) => list.map((c) => (c.id === id ? j.item : c)))
      if (j.found > 0) toast.success(`${j.found} ${t('opp_contacts_found')}`)
      else toast.info(t('opp_contacts_none_found'))
    } catch {
      toast.error(t('opp_scan_failed'))
    } finally {
      setHuntingId(null)
    }
  }

  async function setStatus(id: string, status: CompanyStatus) {
    setBusyId(id)
    const prev = items
    setItems((list) => list.map((c) => (c.id === id ? { ...c, status } : c)))
    try {
      const res = await fetch(`/api/companies/${id}`, {
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
      const res = await fetch(`/api/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error()
      setItems((list) => list.map((c) => (c.id === id ? { ...c, notes } : c)))
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
    setItems((list) => list.filter((c) => c.id !== id))
    try {
      const res = await fetch(`/api/companies/${id}`, { method: 'DELETE' })
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
      /* clipboard blocked */
    }
  }

  const cities = useMemo(
    () => Array.from(new Set(items.map((c) => c.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar')),
    [items],
  )

  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (sizeFilter !== 'all' && c.size !== sizeFilter) return false
      if (cityFilter !== 'all' && c.city !== cityFilter) return false
      if (!q) return true
      return [c.name, c.city, c.summary, c.projects, c.whyRelevant, c.targeting]
        .some((f) => (f || '').toLowerCase().includes(q))
    })
  }, [items, statusFilter, sizeFilter, cityFilter, search])

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: base.length }
    for (const c of COMPANY_CATEGORIES) m[c.key] = base.filter((x) => x.category === c.key).length
    return m
  }, [base])

  const filtered = useMemo(
    () => (activeTab === 'all' ? base : base.filter((c) => c.category === activeTab)),
    [base, activeTab],
  )

  const tabs: Array<{ key: 'all' | CompanyCategory; label: string; icon: LucideIcon }> = [
    { key: 'all', label: t('opp_all'), icon: Building },
    ...COMPANY_CATEGORIES.map((c) => ({
      key: c.key as CompanyCategory,
      label: c[lang],
      icon: CATEGORY_ICON[c.key],
    })),
  ]

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center shadow-md flex-shrink-0">
            <Building className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('co_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('co_subtitle')}</p>
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
            <span className="flex items-center gap-2 text-indigo-700 font-medium">
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
              <span className="text-muted-foreground">+{lastRun.added} {t('opp_new_found')}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('opp_never_scanned')}</span>
          )}
          <span className="text-muted-foreground ms-auto">{items.length} {t('co_count')}</span>
        </CardContent>
      </Card>

      {/* Tabs */}
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
              placeholder={t('co_search_placeholder')}
              className={isRtl ? 'pr-10' : 'pl-10'}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | CompanyStatus)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">{t('opp_all_statuses')}</option>
            {COMPANY_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s[lang]}</option>
            ))}
          </select>
          <select
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value as 'all' | CompanySize)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="all">{t('co_all_sizes')}</option>
            {COMPANY_SIZES.map((s) => (
              <option key={s.key} value={s.key}>{s[lang]}</option>
            ))}
          </select>
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
        </CardContent>
      </Card>

      {/* Cards */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Building className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-medium text-gray-900">
              {items.length === 0 ? t('co_empty') : t('co_no_results')}
            </p>
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t('co_empty_hint')}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((c) => {
            const Icon = CATEGORY_ICON[c.category]
            const draft = noteDrafts[c.id]
            const dirty = draft !== undefined && draft !== c.notes
            return (
              <Card key={c.id} className="flex flex-col">
                <CardContent className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn('w-11 h-11 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0', scoreAccent(c.score))}
                      title={`${t('opp_priority')}: ${c.score}/100`}
                    >
                      {c.score}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 leading-snug">{c.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border', CATEGORY_ACCENT[c.category])}>
                          <Icon className="w-3 h-3" />
                          {companyCategoryLabel(c.category, lang)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs border bg-gray-50 text-gray-600 border-gray-200">
                          {companySizeLabel(c.size, lang)}
                        </span>
                        <span className={cn('px-2 py-0.5 rounded-full text-xs border', STATUS_ACCENT[c.status])}>
                          {companyStatusLabel(c.status, lang)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {c.city && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5" />
                      {c.city}
                    </div>
                  )}

                  {c.summary && <p className="text-sm text-gray-600 leading-relaxed">{c.summary}</p>}

                  {c.projects && (
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-2.5">
                      <p className="text-xs font-semibold text-gray-700 mb-0.5">{t('co_projects')}</p>
                      <p className="text-sm text-gray-700/90 leading-relaxed">{c.projects}</p>
                    </div>
                  )}

                  {c.whyRelevant && (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5">
                      <p className="text-xs font-semibold text-emerald-800 mb-0.5">{t('co_why')}</p>
                      <p className="text-sm text-emerald-900/90 leading-relaxed">{c.whyRelevant}</p>
                    </div>
                  )}

                  {c.targeting && (
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
                      <p className="text-xs font-semibold text-blue-800 mb-0.5">{t('opp_targeting')}</p>
                      <p className="text-sm text-blue-900/90 leading-relaxed whitespace-pre-line">{c.targeting}</p>
                    </div>
                  )}

                  {/* Contacts */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-gray-700">{t('opp_contacts')}</p>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => findContacts(c.id)}
                        disabled={huntingId === c.id}
                        className="gap-1.5 h-7"
                      >
                        {huntingId === c.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {t('opp_finding_contacts')}
                          </>
                        ) : (
                          <>
                            <Search className="w-3 h-3" />
                            {c.contactsFetchedAt ? t('opp_contacts_retry') : t('opp_find_contacts')}
                          </>
                        )}
                      </Button>
                    </div>
                    {c.contacts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {c.contactsFetchedAt ? t('opp_contacts_none_found') : t('opp_no_contacts')}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {c.contacts.map((ct, i) => (
                          <div key={i} className="rounded-md bg-gray-50 border border-gray-100 p-2 text-xs">
                            {(ct.name || ct.role) && (
                              <p className="font-medium text-gray-800">
                                {ct.name}{ct.name && ct.role ? ' — ' : ''}{ct.role}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              {ct.email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="w-3 h-3 text-muted-foreground" />
                                  <a href={`mailto:${ct.email}`} className="text-blue-600 hover:underline break-all">{ct.email}</a>
                                  <button onClick={() => copy(ct.email)} className="text-muted-foreground hover:text-gray-700" aria-label={t('opp_copied')}>
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </span>
                              )}
                              {ct.phone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="w-3 h-3 text-muted-foreground" />
                                  <a href={`tel:${ct.phone}`} className="text-blue-600 hover:underline" dir="ltr">{ct.phone}</a>
                                  <button onClick={() => copy(ct.phone)} className="text-muted-foreground hover:text-gray-700" aria-label={t('opp_copied')}>
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </span>
                              )}
                              {ct.website && (
                                <a href={ct.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
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

                  {c.sourceUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {c.sourceUrls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
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
                      value={draft ?? c.notes}
                      onChange={(e) => setNoteDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      placeholder={t('opp_notes_placeholder')}
                      rows={2}
                      className="w-full rounded-md border border-input bg-transparent p-2 text-sm resize-y"
                    />
                    {dirty && (
                      <Button size="sm" onClick={() => saveNote(c.id)} disabled={busyId === c.id} className="mt-1.5 gap-1.5">
                        {busyId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        {t('opp_save')}
                      </Button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <select
                      value={c.status}
                      onChange={(e) => setStatus(c.id, e.target.value as CompanyStatus)}
                      disabled={busyId === c.id}
                      className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      {COMPANY_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>{s[lang]}</option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(c.id)}
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
