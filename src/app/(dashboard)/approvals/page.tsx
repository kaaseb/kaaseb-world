'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Check, X, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/LanguageContext'

interface PendingPoint {
  id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  action_type: string
  object_type: string
  object_name: string | null
  object_id: string | null
  points: number
  is_off_day: boolean
  status: 'pending' | 'approved' | 'rejected'
  reviewed_at: string | null
  created_at: string
}

export default function ApprovalsPage() {
  const { t, lang, isRtl } = useLanguage()
  const supabase = createClient()
  const [items, setItems] = useState<PendingPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [processing, setProcessing] = useState<string | null>(null)

  const OBJECT_LABELS: Record<string, string> = {
    task: t('obj_task'),
    goal: t('obj_goal'),
    daily_task: t('obj_daily_task'),
  }

  async function load(currentTab = tab) {
    setLoading(true)
    const { data } = await supabase
      .from('pending_points')
      .select('*')
      .eq('status', currentTab)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load(tab)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleAction(item: PendingPoint, action: 'approve' | 'reject') {
    setProcessing(item.id)
    try {
      const res = await fetch(`/api/approvals/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error('Action failed')
      toast.success(action === 'approve' ? t('appr_toast_approved') : t('appr_toast_rejected'))
      load(tab)
    } catch {
      toast.error(t('appr_toast_error'))
    } finally {
      setProcessing(null)
    }
  }

  const pendingCount = tab === 'pending' ? items.length : null

  const tabs = [
    { value: 'pending', label: t('appr_pending') },
    { value: 'approved', label: t('appr_approved') },
    { value: 'rejected', label: t('appr_rejected') },
  ] as const

  return (
    <div className="p-8" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-6">
        <div className={`flex items-center gap-3 mb-1 ${isRtl ? 'flex-row-reverse justify-end' : ''}`}>
          <BadgeCheck className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-900">{t('nav_approvals')}</h1>
        </div>
        <p className={`text-gray-500 ${isRtl ? 'text-right' : ''}`}>{t('appr_desc')}</p>
      </div>

      {/* Tabs */}
      <div className={`flex gap-2 mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
        {tabs.map((tabItem) => (
          <button
            key={tabItem.value}
            onClick={() => setTab(tabItem.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === tabItem.value
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tabItem.label}
            {tabItem.value === 'pending' && pendingCount !== null && pendingCount > 0 && (
              <span className="ml-2 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t('loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <BadgeCheck className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">
            {tab === 'pending' ? t('appr_no_pending') :
             tab === 'approved' ? t('appr_no_approved') : t('appr_no_rejected')}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('name')}</th>
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('email')}</th>
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('appr_col_type')}</th>
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('appr_col_item')}</th>
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('points')}</th>
                <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('date')}</th>
                {tab === 'pending' && (
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('appr_col_action')}</th>
                )}
                {tab !== 'pending' && (
                  <th className={`${isRtl ? 'text-right' : 'text-left'} px-4 py-3 font-semibold text-gray-600`}>{t('status')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={`border-b transition-colors ${item.is_off_day ? 'bg-purple-50/60 hover:bg-purple-50' : 'border-gray-50 hover:bg-gray-50/70'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.user_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{item.user_email || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{OBJECT_LABELS[item.object_type] ?? item.object_type}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{item.object_name || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-bold text-amber-600">
                        {item.points}
                        <span className="text-xs font-normal text-gray-400">{t('user_pts')}</span>
                      </span>
                      {item.is_off_day && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          {t('appr_off_day')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap" suppressHydrationWarning>
                    {new Date(item.created_at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  {tab === 'pending' && (
                    <td className="px-4 py-3">
                      <div className={`flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
                        <button
                          onClick={() => handleAction(item, 'approve')}
                          disabled={processing === item.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          {t('appr_approve')}
                        </button>
                        <button
                          onClick={() => handleAction(item, 'reject')}
                          disabled={processing === item.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                          {t('appr_reject')}
                        </button>
                      </div>
                    </td>
                  )}
                  {tab !== 'pending' && (
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {item.status === 'approved' ? t('appr_approved') : t('appr_rejected')}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
