'use client'

// "صندوق الوارد" — Titan-pulled emails, each convertible into a /projects row.
// Polls only while a pull is running (same light-by-default rule as the scouts).

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Inbox, RefreshCw, Loader2, Trash2, Paperclip, Mail, CalendarDays,
  Briefcase, Archive, AlertCircle, ExternalLink, FileSpreadsheet, PencilRuler, FileText, File as FileIcon,
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
}

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

function fmt(iso: string | null, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function InboxClient({ initialItems, initialLastRun, canCreateProject }: Props) {
  const { t, lang, isRtl } = useLanguage()
  const router = useRouter()

  const [items, setItems] = useState<InboxEmail[]>(initialItems)
  const [lastRun, setLastRun] = useState<PullRun | null>(initialLastRun)
  const [tab, setTab] = useState<EmailStatus>('new')
  const [starting, setStarting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

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
      if (lastRun.status === 'done') toast.success(`${t('inbox_last_pull')}: +${lastRun.added} ${t('inbox_new')}`)
      else if (lastRun.status === 'failed') toast.error(lastRun.error || 'Pull failed', { duration: 12000 })
    }
    wasPulling.current = isPulling
  }, [isPulling, lastRun, t])

  async function pull() {
    setStarting(true)
    try {
      const res = await fetch('/api/inbox/pull', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Failed')
        return
      }
      toast.success(t('inbox_pulling'))
      await refetch()
    } catch {
      toast.error('Failed')
    } finally {
      setStarting(false)
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

  const filtered = useMemo(() => items.filter((e) => e.status === tab), [items, tab])

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
        <Button onClick={pull} disabled={isPulling || starting} className="gap-2">
          {isPulling || starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {isPulling || starting ? t('inbox_pulling') : t('inbox_pull')}
        </Button>
      </div>

      <Card className="mb-4 border-0 shadow-sm">
        <CardContent className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {isPulling ? (
            <span className="flex items-center gap-2 text-blue-700 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('inbox_pulling')}
            </span>
          ) : lastRun?.status === 'failed' ? (
            <span className="flex items-center gap-2 text-red-600 font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {lastRun.error}
            </span>
          ) : lastRun?.finishedAt ? (
            <span className="text-muted-foreground">
              {t('inbox_last_pull')}: <span className="text-gray-900 font-medium">{fmt(lastRun.finishedAt, lang)}</span>
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

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Inbox className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-medium text-gray-900">{t('inbox_empty')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('inbox_empty_hint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((e) => (
            <Card key={e.id}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{e.subject}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{e.fromName || e.fromEmail}</span>
                      {e.date && <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{fmt(e.date, lang)}</span>}
                      <span className="flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />{e.attachments.length} {t('inbox_attachments')}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-600 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

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

                <div className="flex items-center gap-2 pt-1">
                  {e.status === 'converted' && e.projectId ? (
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
          ))}
        </div>
      )}
    </div>
  )
}
