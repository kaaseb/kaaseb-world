'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface AuditLog {
  id: string
  user_name: string | null
  user_email: string | null
  action_type: string
  object_type: string
  object_name: string | null
  object_id: string | null
  created_at: string
}

const ACTION_COLORS: Record<string, string> = {
  add: 'bg-green-100 text-green-700',
  edit: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
}

const PAGE_SIZE = 20

export function AuditClient() {
  const { t, lang, isRtl } = useLanguage()
  const supabase = createClient()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function fetchLogs(pageNum: number) {
    setLoading(true)
    const from = (pageNum - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (filter !== 'all') {
      query = query.eq('action_type', filter)
    }

    const { data, count } = await query
    setLogs(data || [])
    setTotal(count ?? 0)
    setLoading(false)
  }

  // Reset to page 1 whenever the filter changes; otherwise just refetch the
  // current page. Keeps state predictable when the user toggles filters.
  useEffect(() => {
    setPage(1)
    fetchLogs(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => {
    fetchLogs(page)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const actionLabels: Record<string, string> = {
    add: t('add'),
    edit: t('edit'),
    delete: t('delete'),
  }

  const objectLabels: Record<string, string> = {
    task: t('obj_task'),
    goal: t('obj_goal'),
    store: t('obj_store'),
    department: t('obj_department'),
    project: t('obj_project'),
    user: t('obj_user'),
    notification: t('obj_notification'),
    daily_task: t('obj_daily_task'),
    achievement: t('obj_achievement'),
    reward: t('obj_reward'),
  }

  const filters = [
    { value: 'all', label: t('filter_all') },
    { value: 'add', label: t('add') },
    { value: 'edit', label: t('edit') },
    { value: 'delete', label: t('delete') },
  ]

  // Build a compact range of page buttons centered on the current page so the
  // pager doesn't blow out wide on a 50+ page log.
  function pageRange(): (number | '…')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const out: (number | '…')[] = [1]
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)
    if (start > 2) out.push('…')
    for (let i = start; i <= end; i++) out.push(i)
    if (end < totalPages - 1) out.push('…')
    out.push(totalPages)
    return out
  }

  return (
    <div className="p-8" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className={`flex items-center gap-3 mb-1 ${isRtl ? 'flex-row-reverse justify-end' : ''}`}>
            <ClipboardList className="w-6 h-6 text-gray-700" />
            <h1 className="text-2xl font-bold text-gray-900">{t('nav_audit')}</h1>
          </div>
          <p className={`text-gray-500 ${isRtl ? 'text-right' : ''}`}>{t('audit_desc')}</p>
        </div>

        {/* Filter */}
        <div className={`flex gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t('loading')}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">{t('audit_empty')}</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('name')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('email')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('audit_col_item')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('audit_col_action')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('audit_col_type')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('audit_col_id')}</th>
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('audit_col_datetime')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{log.user_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{log.user_email || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{log.object_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {actionLabels[log.action_type] ?? log.action_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{objectLabels[log.object_type] ?? log.object_type}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs" title={log.object_id ?? ''}>
                      {log.object_id ? log.object_id.slice(0, 8) + '...' : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap" suppressHydrationWarning>
                      {new Date(log.created_at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination — only show when there's more than one page */}
          {totalPages > 1 && (
            <div className={`mt-4 flex items-center justify-between text-sm ${isRtl ? 'flex-row-reverse' : ''}`}>
              <p className="text-gray-500">
                {t('audit_showing')} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {t('audit_of')} {total}
              </p>
              <div className={`flex items-center gap-1 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t('audit_prev')}
                >
                  {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
                {pageRange().map((p, i) => (
                  p === '…' ? (
                    <span key={`gap-${i}`} className="px-2 text-gray-400">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors ${
                        p === page
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {p}
                    </button>
                  )
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t('audit_next')}
                >
                  {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
