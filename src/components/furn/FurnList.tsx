'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Pagination, usePagination } from '@/components/ui/pagination'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  Flame, Plus, Search, Eye, Trash2, FileText, AlertCircle, CheckCircle2, Clock3, Loader2,
} from 'lucide-react'
import type { FurnProject, FurnStage, FurnStatus } from '@/types'

interface Props {
  initialProjects: FurnProject[]
  canCreate: boolean
  canDelete: boolean
}

const STAGE_KEY: Record<FurnStage, string> = {
  processing: 'furn_stage_processing',
  pricing: 'furn_stage_pricing',
  quoted: 'furn_stage_quoted',
}
const STATUS_KEY: Record<FurnStatus, string> = {
  pending: 'furn_status_pending',
  in_progress: 'furn_status_in_progress',
  completed: 'furn_status_completed',
  rejected: 'furn_status_rejected',
  archived: 'furn_status_archived',
}

const STAGE_STYLES: Record<FurnStage, string> = {
  processing: 'bg-amber-50 text-amber-700 border-amber-200',
  pricing: 'bg-blue-50 text-blue-700 border-blue-200',
  quoted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}
const STATUS_STYLES: Record<FurnStatus, string> = {
  pending: 'bg-gray-50 text-gray-600 border-gray-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  archived: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}
const STATUS_ICONS: Record<FurnStatus, typeof Clock3> = {
  pending: Clock3,
  in_progress: Loader2,
  completed: CheckCircle2,
  rejected: AlertCircle,
  archived: FileText,
}

export function FurnList({ initialProjects, canCreate, canDelete }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [projects, setProjects] = useState<FurnProject[]>(initialProjects)
  const [stageFilter, setStageFilter] = useState<FurnStage | ''>('')
  const [statusFilter, setStatusFilter] = useState<FurnStatus | ''>('')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (stageFilter && p.stage !== stageFilter) return false
      if (statusFilter && p.status !== statusFilter) return false
      if (q) {
        // Search across project name, company, engineer name and engineer
        // phone — bilingual content is just a substring match, which works
        // the same way for Arabic and English.
        const hay = [
          p.project_name, p.company_name, p.engineer_name, p.engineer_phone,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [projects, stageFilter, statusFilter, search])

  useEffect(() => { setPage(1) }, [search, stageFilter, statusFilter])
  const paged = usePagination({ items: filtered, perPage: 20, page })

  async function handleDelete(p: FurnProject) {
    if (!confirm(t('furn_delete_confirm'))) return
    setDeleting(p.id)
    const res = await fetch(`/api/furn/projects/${p.id}`, { method: 'DELETE' })
    setDeleting(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Failed')
      return
    }
    setProjects(prev => prev.filter(x => x.id !== p.id))
    toast.success(t('furn_action_delete'))
  }

  const stageOptions: Array<{ value: FurnStage; label: string }> = [
    { value: 'processing', label: t('furn_stage_processing') },
    { value: 'pricing', label: t('furn_stage_pricing') },
    { value: 'quoted', label: t('furn_stage_quoted') },
  ]
  const statusOptions: Array<{ value: FurnStatus; label: string }> = [
    { value: 'pending', label: t('furn_status_pending') },
    { value: 'in_progress', label: t('furn_status_in_progress') },
    { value: 'completed', label: t('furn_status_completed') },
    { value: 'rejected', label: t('furn_status_rejected') },
    { value: 'archived', label: t('furn_status_archived') },
  ]

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-white flex items-center justify-center shadow-md">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('furn_title')}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t('furn_subtitle')}</p>
            </div>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/furn/new')} size="lg" className="bg-orange-600 hover:bg-orange-700 text-white">
            <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
            {t('furn_new_project')}
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`} />
              <Input
                placeholder={t('furn_search')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={isRtl ? 'pr-10' : 'pl-10'}
              />
            </div>
            <select
              className="bg-background border border-input rounded-md text-sm px-3 py-2"
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value as FurnStage | '')}
            >
              <option value="">{t('furn_filter_stage')} — {t('furn_filter_all')}</option>
              {stageOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              className="bg-background border border-input rounded-md text-sm px-3 py-2"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as FurnStatus | '')}
            >
              <option value="">{t('furn_filter_status')} — {t('furn_filter_all')}</option>
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm py-0">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Flame className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
              <p>{t('furn_empty')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr className="text-start">
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground w-20">{t('furn_col_id')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_project')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_company')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_dept')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_stage')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_status')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_created')}</th>
                    <th className="px-4 py-3 text-start font-medium text-muted-foreground">{t('furn_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paged.slice.map(p => {
                    const StatusIcon = STATUS_ICONS[p.status]
                    const dept = p.ai_detected_departments?.length
                      ? p.ai_detected_departments.slice(0, 2).join(' · ')
                      : '—'
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-4 py-3 align-middle">
                          <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                            {String(p.project_number).padStart(6, '0')}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          <Link href={`/furn/${p.id}`} className="hover:underline">
                            {p.project_name}
                          </Link>
                          {p.subject && <p className="text-xs text-muted-foreground mt-0.5">{p.subject}</p>}
                        </td>
                        <td className="px-4 py-3 text-foreground/80">{p.company_name}</td>
                        <td className="px-4 py-3 text-foreground/80">{dept}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${STAGE_STYLES[p.stage]}`}>
                            {t(STAGE_KEY[p.stage] as Parameters<typeof t>[0])}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {/* Status pill — icon stays STATIC even on
                              `in_progress`. The status is a workflow state
                              (the project is between pending and completed),
                              not a live progress signal, so a spinner here
                              lied about the AI running indefinitely after
                              extraction had already finished. */}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${STATUS_STYLES[p.status]}`}>
                            <StatusIcon className="w-3 h-3" />
                            {t(STATUS_KEY[p.status] as Parameters<typeof t>[0])}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap" dir="ltr">
                          {new Date(p.created_at).toLocaleDateString('en-GB')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Link
                              href={`/furn/${p.id}`}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition"
                              title="View"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(p)}
                                disabled={deleting === p.id}
                                className="text-red-600 hover:bg-red-50 hover:text-red-700"
                              >
                                {deleting === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </Button>
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
    </div>
  )
}
