'use client'

import { useLanguage } from '@/contexts/LanguageContext'

interface AnalyticsClientProps {
  totalDepts: number
  totalProjects: number
  totalTasks: number
  doneTasks: number
  topUsers: { full_name: string | null; total_points: number; avatar_url: string | null }[]
}

export function AnalyticsClient({ totalDepts, totalProjects, totalTasks, doneTasks, topUsers }: AnalyticsClientProps) {
  const { t, isRtl } = useLanguage()
  const completionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0

  const stats = [
    { label: t('dashboard_stat_depts'), value: totalDepts, color: 'bg-blue-500' },
    { label: t('dashboard_stat_projects'), value: totalProjects, color: 'bg-violet-500' },
    { label: t('analytics_total'), value: totalTasks, color: 'bg-gray-500' },
    { label: t('analytics_done'), value: doneTasks, color: 'bg-green-500' },
  ]

  return (
    <div className="p-8" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('analytics_title')}</h1>
        <p className="text-gray-500 mt-1">{t('analytics_subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map(stat => (
          <div key={stat.label} className="bg-white rounded-xl shadow-sm p-6 border-0">
            <div className={`w-2 h-2 rounded-full ${stat.color} mb-4`} />
            <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task Completion */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('analytics_completion_rate')}</h2>
          <div className="flex items-center justify-center">
            <div className="relative w-40 h-40">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray={`${completionRate}, 100`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-900">{completionRate}%</div>
                  <div className="text-xs text-gray-400">{t('analytics_complete')}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-around mt-6 text-center">
            <div>
              <div className="text-lg font-bold text-gray-900">{totalTasks}</div>
              <div className="text-xs text-gray-500">{t('analytics_total')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-green-600">{doneTasks}</div>
              <div className="text-xs text-gray-500">{t('analytics_done')}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600">{totalTasks - doneTasks}</div>
              <div className="text-xs text-gray-500">{t('analytics_remaining')}</div>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-6">{t('analytics_leaderboard')}</h2>
          <div className="space-y-3">
            {topUsers.map((u, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm font-bold text-gray-300 w-5">{i + 1}</span>
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 overflow-hidden">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (u.full_name || 'U')[0].toUpperCase()
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{u.full_name || 'Unknown'}</span>
                    <span className="text-xs font-bold text-amber-600">{u.total_points} {t('analytics_pts')}</span>
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, (u.total_points / (topUsers[0]?.total_points || 1)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
