'use client'

// "صندوق الوارد" — Titan-pulled emails, each convertible into a /projects row.
//
// Two-tier: a cheap LIST sync mirrors the whole recent mailbox by NAME (envelope
// only). The owner searches/filters that list, then presses "جهّز الملخص" on the
// ones worth it — only THEN are that message's attachments + AI summary pulled.
// Polls only while a list sync is running (same light-by-default rule as scouts).

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Inbox, RefreshCw, Loader2, Trash2, Paperclip, Mail, CalendarDays,
  Briefcase, Archive, AlertCircle, ExternalLink, FileSpreadsheet, PencilRuler,
  FileText, File as FileIcon, Sparkles, Search, X, KeyRound, ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/LanguageContext'
import type { InboxEmail, PullRun, EmailStatus } from '@/lib/inbox/store'

interface Props {
  initialItems: InboxEmail[]
  initialLastRun: PullRun | null
  canCreateProject: boolean
  isSuperAdmin: boolean
}

const PAGE = 25

const CAT_ICON: Record<string, LucideIcon> = {
  boq: FileSpreadsheet,
  drawing: PencilRuler,
  spec: FileText,
  other: FileIcon,
}
const CAT_LABEL: Record<string, { en: string; ar: string }> = {
  boq: { en: 'BOQ', ar: 'كميات' },
  drawing: { en: 'Drawing', ar: 'رسمة' },
  spec: { en: 'Spec', ar: 'مواصفات' },
  other: { en: 'Other', ar: 'أخرى' },
}

function fileCounts(e: InboxEmail): { boq: number; drawing: number; spec: number; other: number } {
  const c = { boq: 0, drawing: 0, spec: 0, other: 0 }
  for (const a of e.attachments) c[a.category]++
  return c
}

function fmt(iso: string | null, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function InboxClient({ initialItems, initialLastRun, canCreateProject, isSuperAdmin }: Props) {
  const { t, lang, isRtl } = useLanguage()
  const router = useRouter()

  const [items, setItems] = useState<InboxEmail[]>(initialItems)
  const [lastRun, setLastRun] = useState<PullRun | null>(initialLastRun)
  const [tab, setTab] = useState<EmailStatus>('new')
  const [starting, setStarting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Super-admin: change the shared PIN
  const [showPin, setShowPin] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [visible, setVisible] = useState(PAGE)

  const isPulling = lastRun?.status === 'running'

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox')
      if (!res.ok) return
      const j = await res.json()
      if (Array.isArray(j.items)) setItems(j.items)
      setLastRun(j.lastRun ?? null)
    } catch {
      /* next poll */
    }
  }, [])

  useEffect(() => {
    if (!isPulling) return
    const id = setInterval(refetch, 5000)
    return () => clearInterval(id)
  }, [isPulling, refetch])

  const wasPulling = useRef(isPulling)
  useEffect(() => {
    if (wasPulling.current && !isPulling && lastRun) {
      if (lastRun.status === 'done') toast.success(`${t('inbox_last_sync')}: +${lastRun.added} ${t('inbox_new')}`)
      else if (lastRun.status === 'failed') toast.error(lastRun.error || 'Failed', { duration: 12000 })
    }
    wasPulling.current = isPulling
  }, [isPulling, lastRun, t])

  // Reset the page window whenever the visible set changes shape.
  useEffect(() => { setVisible(PAGE) }, [tab, search, dateFrom, dateTo])

  async function pull() {
    setStarting(true)
    try {
      const res = await fetch('/api/inbox/pull', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Failed')
        return
      }
      toast.success(t('inbox_refreshing'))
      await refetch()
    } catch {
      toast.error('Failed')
    } finally {
      setStarting(false)
    }
  }

  async function changePin(e: React.FormEvent) {
    e.preventDefault()
    if (savingPin) return
    if (newPin.trim().length < 4) { toast.error(t('inbox_pin_too_short')); return }
    if (newPin.trim() !== confirmPin.trim()) { toast.error(t('inbox_pin_mismatch')); return }
    setSavingPin(true)
    try {
      const res = await fetch('/api/inbox/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin: newPin.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      toast.success(t('inbox_pin_saved'))
      setShowPin(false); setNewPin(''); setConfirmPin('')
    } catch {
      toast.error('Failed')
    } finally {
      setSavingPin(false)
    }
  }

  async function hydrate(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/inbox/${id}/hydrate`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Failed', { duration: 10000 })
        return
      }
      if (j.email) setItems((list) => list.map((e) => (e.id === id ? j.email : e)))
      toast.success(lang === 'ar' ? 'تم التجهيز ✓' : 'Prepared ✓')
    } catch {
      toast.error('Failed')
    } finally {
      setBusyId(null)
    }
  }

  async function convert(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/inbox/${id}/convert`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Failed', { duration: 10000 })
        return
      }
      setItems((list) => list.map((e) => (e.id === id ? { ...e, status: 'converted', projectId: j.project?.id ?? null } : e)))
      toast.success(t('inbox_converted'))
      if (j.project?.id) router.push(`/projects/${j.project.id}`)
    } catch {
      toast.error('Failed')
    } finally {
      setBusyId(null)
    }
  }

  async function archive(id: string) {
    setBusyId(id)
    const prev = items
    setItems((list) => list.map((e) => (e.id === id ? { ...e, status: 'archived' } : e)))
    try {
      const res = await fetch(`/api/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setItems(prev)
      toast.error('Failed')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!confirm(t('inbox_delete_confirm'))) return
    const prev = items
    setItems((list) => list.filter((e) => e.id !== id))
    try {
      const res = await fetch(`/api/inbox/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setItems(prev)
      toast.error('Failed')
    }
  }

  const counts = useMemo(() => ({
    new: items.filter((e) => e.status === 'new').length,
    converted: items.filter((e) => e.status === 'converted').length,
    archived: items.filter((e) => e.status === 'archived').length,
  }), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((e) => {
      if (e.status !== tab) return false
      if (q) {
        const hay = `${e.subject} ${e.fromName} ${e.fromEmail} ${e.preview?.projectName || ''} ${e.preview?.summary || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const day = (e.date || '').slice(0, 10)
      if (dateFrom && day && day < dateFrom) return false
      if (dateTo && day && day > dateTo) return false
      return true
    })
  }, [items, tab, search, dateFrom, dateTo])

  const shown = filtered.slice(0, visible)
  const hasFilters = !!(search || dateFrom || dateTo)

  const tabs: Array<{ key: EmailStatus; label: string; icon: LucideIcon; count: number }> = [
    { key: 'new', label: t('inbox_tab_new'), icon: Mail, count: counts.new },
    { key: 'converted', label: t('inbox_tab_converted'), icon: Briefcase, count: counts.converted },
    { key: 'archived', label: t('inbox_tab_archived'), icon: Archive, count: counts.archived },
  ]

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md">
            <Inbox className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('inbox_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('inbox_subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button variant="outline" onClick={() => setShowPin((v) => !v)} className="gap-2">
              <KeyRound className="w-4 h-4" /> {t('inbox_change_pin')}
            </Button>
          )}
          <Button onClick={pull} disabled={isPulling || starting} className="gap-2">
            {isPulling || starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isPulling || starting ? t('inbox_refreshing') : t('inbox_refresh_list')}
          </Button>
        </div>
      </div>

      {isSuperAdmin && showPin && (
        <Card className="mb-4 border shadow-sm">
          <CardContent className="p-4">
            <form onSubmit={changePin} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <ShieldCheck className="w-4 h-4 text-blue-600" /> {t('inbox_change_pin')}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder={t('inbox_new_pin')}
                  className="flex-1 h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <input
                  type="password"
                  inputMode="numeric"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  placeholder={t('inbox_confirm_pin')}
                  className="flex-1 h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={savingPin} className="gap-1.5">
                  {savingPin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  {t('inbox_pin_save')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowPin(false); setNewPin(''); setConfirmPin('') }}>
                  {t('inbox_pin_cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4 border-0 shadow-sm">
        <CardContent className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {isPulling ? (
            <span className="flex items-center gap-2 text-blue-700 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('inbox_refreshing')}
            </span>
          ) : lastRun?.status === 'failed' ? (
            <span className="flex items-center gap-2 text-red-600 font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {lastRun.error}
            </span>
          ) : lastRun?.finishedAt ? (
            <span className="text-muted-foreground">
              {t('inbox_last_sync')}: <span className="text-gray-900 font-medium">{fmt(lastRun.finishedAt, lang)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('inbox_never')}</span>
          )}
        </CardContent>
      </Card>

      <div className="mb-4 inline-flex gap-2 flex-wrap">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === key ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
            <span className={cn('inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-bold', tab === key ? 'bg-white/20 text-white' : 'bg-white text-gray-500')}>{count}</span>
          </button>
        ))}
      </div>

      {/* Search + date-range filters */}
      <div className="mb-3 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className={cn('w-4 h-4 text-muted-foreground absolute top-1/2 -translate-y-1/2', isRtl ? 'right-3' : 'left-3')} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inbox_search_placeholder')}
            className={cn('w-full h-10 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100', isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3')}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{t('inbox_date_from')}</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-400" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{t('inbox_date_to')}</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-400" />
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }} className="gap-1 text-muted-foreground">
              <X className="w-3.5 h-3.5" /> {t('inbox_clear_filters')}
            </Button>
          )}
        </div>
      </div>

      {/* Count line */}
      <p className="text-xs text-muted-foreground mb-3">
        {t('inbox_showing')} {shown.length} {t('inbox_of')} {filtered.length}
        {tab === 'new' && <span className="ms-2 opacity-80">· {t('inbox_list_hint')}</span>}
      </p>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Inbox className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-medium text-gray-900">{hasFilters ? t('inbox_no_results') : t('inbox_empty')}</p>
            {!hasFilters && <p className="text-sm text-muted-foreground mt-1">{t('inbox_empty_hint')}</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {shown.map((e) => {
              const c = fileCounts(e)
              const attCount = e.hydrated ? e.attachments.length : e.attachmentCount
              return (
              <Card key={e.id}>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 leading-snug">{e.preview?.projectName || e.subject}</h3>
                      {e.preview?.projectName && e.preview.projectName !== e.subject && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{e.subject}</p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                        <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{t('inbox_from')}: {e.fromName || e.fromEmail}</span>
                        {e.date && <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{t('inbox_received')}: {fmt(e.date, lang)}</span>}
                        {attCount > 0 && <span className="flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{attCount} {t('inbox_attachments')}</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-600 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {!e.hydrated ? (
                    /* Listed-only envelope — names only, not yet fetched */
                    <span className="inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 border border-gray-200">
                      <Sparkles className="w-3.5 h-3.5" /> {t('inbox_not_prepared')}
                    </span>
                  ) : (
                    <>
                      {e.preview?.summary && (
                        <p className="text-sm text-gray-600 leading-relaxed">{e.preview.summary}</p>
                      )}

                      {(e.preview?.highlights?.length || c.boq || c.drawing || c.spec) ? (
                        <div className="flex flex-wrap gap-1.5">
                          {c.boq > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">{c.boq} {t('inbox_files_boq')}</span>}
                          {c.drawing > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">{c.drawing} {t('inbox_files_drawing')}</span>}
                          {c.spec > 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-200">{c.spec} {t('inbox_files_spec')}</span>}
                          {(e.preview?.highlights || []).map((h, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-800 border border-amber-200">{h}</span>
                          ))}
                        </div>
                      ) : null}

                      {e.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {e.attachments.slice(0, 20).map((a, i) => {
                            const Icon = CAT_ICON[a.category] || FileIcon
                            return (
                              <a
                                key={i}
                                href={a.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={a.name}
                                className="inline-flex items-center gap-1 max-w-[220px] px-2 py-1 rounded-md bg-gray-50 border border-gray-100 text-xs hover:bg-gray-100"
                              >
                                <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="truncate">{a.name}</span>
                                <span className="text-[10px] text-muted-foreground">{CAT_LABEL[a.category]?.[lang]}</span>
                              </a>
                            )
                          })}
                          {e.attachments.length > 20 && (
                            <span className="inline-flex items-center px-2 py-1 text-xs text-muted-foreground">+{e.attachments.length - 20}</span>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!e.hydrated ? (
                      <Button size="sm" onClick={() => hydrate(e.id)} disabled={busyId === e.id} className="gap-1.5">
                        {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        {busyId === e.id ? t('inbox_hydrating') : t('inbox_hydrate')}
                      </Button>
                    ) : e.status === 'converted' && e.projectId ? (
                      <Button variant="outline" size="sm" onClick={() => router.push(`/projects/${e.projectId}`)} className="gap-1.5">
                        <ExternalLink className="w-3.5 h-3.5" /> {t('inbox_open_project')}
                      </Button>
                    ) : canCreateProject ? (
                      <Button size="sm" onClick={() => convert(e.id)} disabled={busyId === e.id} className="gap-1.5">
                        {busyId === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Briefcase className="w-3.5 h-3.5" />}
                        {busyId === e.id ? t('inbox_converting') : t('inbox_convert')}
                      </Button>
                    ) : null}
                    {e.status !== 'archived' && (
                      <Button variant="ghost" size="sm" onClick={() => archive(e.id)} disabled={busyId === e.id} className="gap-1.5 text-muted-foreground">
                        <Archive className="w-3.5 h-3.5" /> {t('inbox_archive')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )})}
          </div>

          {filtered.length > visible && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)} className="gap-2">
                {t('inbox_load_more')} ({filtered.length - visible})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
