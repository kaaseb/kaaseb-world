'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Briefcase, Plus, Search, Eye, Trash2, Loader2, LayoutGrid, List, ChevronDown } from 'lucide-react'
import { Pagination, usePagination } from '@/components/ui/pagination'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ClientProject, ClientProjectStatus, ClientProjectStage } from '@/types'
import type { TranslationKey } from '@/lib/i18n/translations'
import { STATUS_OPTIONS, STAGE_OPTIONS, STATUS_COLORS } from './constants'
import { ClientProjectsKanban, patchClientProjectStatus } from './ClientProjectsKanban'

interface Props {
  initialProjects: ClientProject[]
  canCreate: boolean
  canDelete: boolean
}

// Picks the right bilingual variant. We never want the table to show an
// empty cell when only one language was filled in.
function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

// `en-GB` keeps the day-month-year shape the team is used to, with Latin
// (Western Arabic) digits so the table stays scannable regardless of UI
// language. Falls back to the raw value if the string isn't parseable.
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB')
}

// Patches a single field on the server side. Returns the fresh row on
// success, null on failure (toast already shown).
async function patchField<K extends 'status' | 'stage'>(
  projectId: string,
  key: K,
  value: K extends 'status' ? ClientProjectStatus : ClientProjectStage,
): Promise<ClientProject | null> {
  try {
    const res = await fetch(`/api/client-projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return null
    }
    return j.project as ClientProject
  } catch (e) {
    toast.error(String(e))
    return null
  }
}

export function ClientProjectsList({ initialProjects, canCreate, canDelete }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [projects, setProjects] = useState<ClientProject[]>(initialProjects)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ClientProjectStatus | ''>('')
  const [stageFilter,  setStageFilter]  = useState<ClientProjectStage | ''>('')
  const [deleting, setDeleting] = useState<string | null>(null)
  // Keyed by `${projectId}:${field}` so the spinner only shows on the cell
  // the user is actually flipping.
  const [pendingCell, setPendingCell] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  // Persist the user's last view choice — most teams strongly prefer one
  // mode and don't want to re-pick it on every visit.
  const [view, setView] = useState<'table' | 'kanban'>('table')
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('cp_view') : null
    if (saved === 'kanban' || saved === 'table') setView(saved)
  }, [])
  function changeView(next: 'table' | 'kanban') {
    setView(next)
    try { localStorage.setItem('cp_view', next) } catch { /* ignore */ }
  }

  // Optimistic flip used by both the Kanban drag-and-drop AND the inline
  // status dropdown. Rolls back on failure.
  async function handleStatusMove(project: ClientProject, newStatus: ClientProjectStatus) {
    const prev = projects
    setPendingCell(`${project.id}:status`)
    setProjects(prev.map(p => p.id === project.id ? { ...p, status: newStatus } : p))
    const updated = await patchClientProjectStatus(project, newStatus, t)
    setPendingCell(null)
    if (!updated) {
      setProjects(prev)
    } else {
      setProjects(curr => curr.map(p => p.id === updated.id ? updated : p))
    }
  }

  async function handleStageChange(project: ClientProject, newStage: ClientProjectStage) {
    const prev = projects
    setPendingCell(`${project.id}:stage`)
    setProjects(prev.map(p => p.id === project.id ? { ...p, stage: newStage } : p))
    const updated = await patchField(project.id, 'stage', newStage)
    setPendingCell(null)
    if (!updated) {
      setProjects(prev)
    } else {
      setProjects(curr => curr.map(p => p.id === updated.id ? updated : p))
      toast.success(t('saved'))
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false
      if (stageFilter  && p.stage  !== stageFilter)  return false
      if (q) {
        // Search across project name, engineer name, company name,
        // engineer phone, and the freeform keywords field.
        const hay = [
          p.name_en, p.name_ar, p.company_en, p.company_ar,
          p.engineer_name_en, p.engineer_name_ar, p.engineer_phone,
          p.keywords,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [projects, search, statusFilter, stageFilter])

  // Reset to the first page whenever the filter changes — staying on page
  // 5 after a search collapses the list to 3 items would look broken.
  useEffect(() => { setPage(1) }, [search, statusFilter, stageFilter])

  const paged = usePagination({ items: filtered, perPage: 20, page })

  async function handleDelete(p: ClientProject) {
    if (!confirm(t('cp_delete_confirm'))) return
    setDeleting(p.id)
    const res = await fetch(`/api/client-projects/${p.id}`, { method: 'DELETE' })
    setDeleting(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Failed')
      return
    }
    setProjects(prev => prev.filter(x => x.id !== p.id))
  }

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t('cp_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filtered.length} {t('cp_count')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle — table vs. kanban */}
          <div className="inline-flex items-center rounded-md border p-0.5 bg-background">
            <button
              onClick={() => changeView('table')}
              className={`px-2.5 py-1.5 rounded text-sm flex items-center gap-1 transition ${
                view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => changeView('kanban')}
              className={`px-2.5 py-1.5 rounded text-sm flex items-center gap-1 transition ${
                view === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
              title="Kanban view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          {canCreate && (
            <Button onClick={() => router.push('/projects/new')} size="lg">
              <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
              {t('cp_new_project')}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`} />
            <Input
              placeholder={t('cp_search_ph')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={isRtl ? 'pr-10' : 'pl-10'}
            />
          </div>
          <select
            className="bg-background border border-input rounded-md text-sm px-3 py-2"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ClientProjectStatus | '')}
          >
            <option value="">{t('cp_filter_status')} — {t('cp_filter_all')}</option>
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.key as TranslationKey)}</option>
            ))}
          </select>
          <select
            className="bg-background border border-input rounded-md text-sm px-3 py-2"
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value as ClientProjectStage | '')}
          >
            <option value="">{t('cp_filter_stage')} — {t('cp_filter_all')}</option>
            {STAGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.key as TranslationKey)}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Kanban view */}
      {view === 'kanban' && (
        filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-12 text-center text-muted-foreground">
              <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
              <p>{t('cp_empty')}</p>
            </CardContent>
          </Card>
        ) : (
          <ClientProjectsKanban projects={filtered} onMove={handleStatusMove} />
        )
      )}

      {/* Table view — every column from before, one row per project, with
          inline pickers for status & stage so the team can flip them without
          opening the project. */}
      {view === 'table' && (
      <Card className="border-0 shadow-sm py-0">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
              <p>{t('cp_empty')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/40 border-b">
                  <tr className="text-[12px] text-muted-foreground">
                    <th className="px-3 py-3 text-start font-medium w-14">{t('cp_col_id')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_project')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_company')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_engineer')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_engineer_phone')}</th>
                    <th className="px-3 py-3 text-start font-medium whitespace-nowrap">{t('cp_col_responsible')}</th>
                    <th className="px-3 py-3 text-start font-medium whitespace-nowrap">{t('cp_col_end_date')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_status')}</th>
                    <th className="px-3 py-3 text-start font-medium">{t('cp_col_stage')}</th>
                    <th className="px-3 py-3 text-end font-medium">{t('cp_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paged.slice.map((p) => {
                    const statusOpt = STATUS_OPTIONS.find(o => o.value === p.status)
                    const stageOpt  = STAGE_OPTIONS.find(o => o.value === p.stage)
                    const statusBusy = pendingCell === `${p.id}:status`
                    const stageBusy  = pendingCell === `${p.id}:stage`
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-3 py-2.5 align-middle">
                          <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                            {String(p.project_number).padStart(6, '0')}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle font-medium max-w-[220px]">
                          <Link href={`/projects/${p.id}`} className="hover:underline truncate block">
                            {display(p.name_en, p.name_ar, isRtl)}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-foreground/80 max-w-[180px]">
                          <span className="truncate block">
                            {display(p.company_en, p.company_ar, isRtl)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-foreground/80 max-w-[160px]">
                          <span className="truncate block">
                            {display(p.engineer_name_en, p.engineer_name_ar, isRtl)}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2.5 align-middle text-foreground/80 whitespace-nowrap"
                          dir="ltr"
                        >
                          {p.engineer_phone || '—'}
                        </td>
                        {/* Responsible person — pulled from the responsible_user
                            join. Older rows with no owner show a muted dash. */}
                        <td className="px-3 py-2.5 align-middle text-foreground/80 max-w-[160px]">
                          <span className="truncate block">
                            {p.responsible_user?.full_name
                              || p.responsible_user?.email
                              || '—'}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2.5 align-middle text-muted-foreground whitespace-nowrap"
                          dir="ltr"
                        >
                          {formatDate(p.end_date)}
                        </td>

                        {/* Inline status picker — looks like a colored pill,
                            opens the native select on click. Works for every
                            authenticated user (the API allows status flips
                            without the edit permission). */}
                        <td className="px-3 py-2.5 align-middle">
                          <InlinePicker
                            label={statusOpt ? t(statusOpt.key as TranslationKey) : p.status}
                            value={p.status}
                            onChange={v => handleStatusMove(p, v as ClientProjectStatus)}
                            options={STATUS_OPTIONS.map(o => ({
                              value: o.value,
                              label: t(o.key as TranslationKey),
                            }))}
                            className={`border ${STATUS_COLORS[p.status]}`}
                            busy={statusBusy}
                          />
                        </td>

                        {/* Inline stage picker — neutral styling, same
                            interaction. */}
                        <td className="px-3 py-2.5 align-middle">
                          <InlinePicker
                            label={stageOpt ? t(stageOpt.key as TranslationKey) : p.stage}
                            value={p.stage}
                            onChange={v => handleStageChange(p, v as ClientProjectStage)}
                            options={STAGE_OPTIONS.map(o => ({
                              value: o.value,
                              label: t(o.key as TranslationKey),
                            }))}
                            className="border bg-muted/40 text-foreground/80"
                            busy={stageBusy}
                          />
                        </td>

                        <td className="px-3 py-2.5 align-middle text-end whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <Link
                              href={`/projects/${p.id}`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title={t('cp_back')}
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(p)}
                                disabled={deleting === p.id}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-red-50 text-red-600 transition"
                                title={t('cp_delete_confirm').replace('?', '').replace('؟', '')}
                              >
                                {deleting === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={paged.safePage}
            pageCount={paged.pageCount}
            total={paged.total}
            perPage={20}
            onChange={setPage}
            isRtl={isRtl}
          />
        </CardContent>
      </Card>
      )}
    </div>
  )
}

// Compact pill that doubles as a native <select>. Tapping anywhere on the
// pill opens the OS picker — works on mobile and desktop, keeps the row
// height tight, and inherits accessibility from the underlying control.
function InlinePicker({
  value, label, options, onChange, className, busy,
}: {
  value: string
  label: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
  className?: string
  busy?: boolean
}) {
  return (
    <label
      className={`relative inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-pointer transition hover:brightness-95 max-w-[160px] ${
        className || ''
      } ${busy ? 'opacity-60' : ''}`}
    >
      <span className="truncate" title={label}>{label}</span>
      {busy ? (
        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
      ) : (
        <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
      )}
      <select
        value={value}
        disabled={busy}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
