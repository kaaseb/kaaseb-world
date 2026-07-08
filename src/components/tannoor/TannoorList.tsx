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
  Cookie, Plus, Search, Eye, Trash2, Loader2,
  AlertTriangle, CheckCircle2, Clock3, AlertCircle,
} from 'lucide-react'
import type { TannoorProject, TannoorStatus, TannoorStage } from '@/types'

interface Props {
  initialProjects: TannoorProject[]
  canCreate: boolean
  canDelete: boolean
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

const STATUS_STYLE: Record<TannoorStatus, string> = {
  pending:          'bg-gray-50 text-gray-700 border-gray-200',
  in_progress:      'bg-blue-50 text-blue-700 border-blue-200',
  completed:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:         'bg-red-50 text-red-700 border-red-200',
  archived:         'bg-zinc-100 text-zinc-700 border-zinc-200',
  missing_products: 'bg-orange-100 text-orange-800 border-orange-300 font-bold',
}

export function TannoorList({ initialProjects, canCreate, canDelete }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [projects, setProjects] = useState<TannoorProject[]>(initialProjects)
  const [search, setSearch] = useState('')
  const [stageFilter,  setStageFilter]  = useState<TannoorStage | ''>('')
  const [statusFilter, setStatusFilter] = useState<TannoorStatus | ''>('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (stageFilter  && p.stage  !== stageFilter)  return false
      if (statusFilter && p.status !== statusFilter) return false
      if (q) {
        const hay = [p.project_name_en, p.project_name_ar, p.company_en, p.company_ar].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [projects, search, stageFilter, statusFilter])

  useEffect(() => { setPage(1) }, [search, stageFilter, statusFilter])
  const paged = usePagination({ items: filtered, perPage: 20, page })

  async function handleDelete(p: TannoorProject) {
    if (!confirm(t('furn_delete_confirm'))) return
    setDeleting(p.id)
    const res = await fetch(`/api/tannoor/projects/${p.id}`, { method: 'DELETE' })
    setDeleting(null)
    if (!res.ok) { const j = await res.json().catch(() => ({})); toast.error(j.error || 'Failed'); return }
    setProjects(prev => prev.filter(x => x.id !== p.id))
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-red-600 text-white flex items-center justify-center shadow-md">
            <Cookie className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t('tn_title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('tn_subtitle')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/tannoor/new')} size="lg">
            <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
            {t('tn_new_project')}
          </Button>
        )}
      </div>

      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${isRtl ? 'right-3' : 'left-3'}`} />
            <Input placeholder={t('furn_search')} value={search} onChange={e => setSearch(e.target.value)} className={isRtl ? 'pr-10' : 'pl-10'} />
          </div>
          <select className="bg-background border border-input rounded-md text-sm px-3 py-2" value={stageFilter} onChange={e => setStageFilter(e.target.value as TannoorStage | '')}>
            <option value="">{t('furn_filter_stage')} — {t('furn_filter_all')}</option>
            <option value="processing">{t('furn_stage_processing')}</option>
            <option value="quoted">{t('furn_stage_quoted')}</option>
          </select>
          <select className="bg-background border border-input rounded-md text-sm px-3 py-2" value={statusFilter} onChange={e => setStatusFilter(e.target.value as TannoorStatus | '')}>
            <option value="">{t('furn_filter_status')} — {t('furn_filter_all')}</option>
            <option value="pending">{t('furn_status_pending')}</option>
            <option value="in_progress">{t('furn_status_in_progress')}</option>
            <option value="completed">{t('furn_status_completed')}</option>
            <option value="rejected">{t('furn_status_rejected')}</option>
            <option value="archived">{t('furn_status_archived')}</option>
            <option value="missing_products">{t('tn_status_missing_products')}</option>
          </select>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm py-0">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Cookie className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
              <p>{t('furn_empty')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground w-20">{t('furn_col_id')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_project')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_company')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_stage')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_status')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_created')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('furn_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paged.slice.map(p => {
                    const StatusIcon =
                      p.status === 'missing_products' ? AlertTriangle :
                      p.status === 'completed' ? CheckCircle2 :
                      p.status === 'in_progress' ? Loader2 :
                      p.status === 'rejected' ? AlertCircle : Clock3
                    return (
                      <tr key={p.id} className="hover:bg-muted/30 transition">
                        <td className="px-3 py-3 align-middle">
                          <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                            {String(p.project_number).padStart(6, '0')}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-medium">
                          <Link href={`/tannoor/${p.id}`} className="hover:underline">
                            {display(p.project_name_en, p.project_name_ar, isRtl)}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-foreground/80">{display(p.company_en, p.company_ar, isRtl)}</td>
                        <td className="px-3 py-3 text-foreground/80 text-xs">
                          {p.stage === 'processing' ? t('furn_stage_processing') : t('furn_stage_quoted')}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${STATUS_STYLE[p.status]}`}>
                            {/* Static icon — see FurnList for the rationale.
                                in_progress is a workflow state, not a live
                                spinner. */}
                            <StatusIcon className="w-3 h-3" />
                            {p.status === 'missing_products'
                              ? t('tn_status_missing_products')
                              : p.status === 'pending' ? t('furn_status_pending')
                              : p.status === 'in_progress' ? t('furn_status_in_progress')
                              : p.status === 'completed' ? t('furn_status_completed')
                              : p.status === 'rejected' ? t('furn_status_rejected')
                              : t('furn_status_archived')}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap" dir="ltr">
                          {new Date(p.created_at).toLocaleDateString('en-GB')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <Link href={`/tannoor/${p.id}`} className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted">
                              <Eye className="w-4 h-4" />
                            </Link>
                            {canDelete && (
                              <button onClick={() => handleDelete(p)} disabled={deleting === p.id}
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-50 text-red-600">
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
    </div>
  )
}
