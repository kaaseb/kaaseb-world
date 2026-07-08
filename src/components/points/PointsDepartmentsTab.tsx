'use client'

import { useMemo } from 'react'
import { Building2, Trophy, Star } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { DepartmentWithMembers } from '@/app/(dashboard)/points/page'

interface Props {
  departments: DepartmentWithMembers[]
}

export function PointsDepartmentsTab({ departments }: Props) {
  const { t } = useLanguage()

  const rows = useMemo(() => {
    return departments.map(d => {
      const members = d.department_members || []
      const total = members.reduce((sum, m) => sum + (m.profiles?.total_points || 0), 0)
      return { id: d.id, name: d.name, icon: d.icon, color: d.color, memberCount: members.length, total }
    }).sort((a, b) => b.total - a.total)
  }, [departments])

  const totalPoints = rows.reduce((s, r) => s + r.total, 0)

  const [first, second, third] = [rows[0], rows[1], rows[2]]
  const rest = rows.slice(3)

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-amber-500" />
        {t('points_dept_competition')}
      </h2>

      {/* Stat pills */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatPill icon={<Building2 className="w-4 h-4 text-purple-600" />} value={rows.length} label={t('points_depts_count')} />
        <StatPill icon={<Star className="w-4 h-4 text-amber-500" />} value={totalPoints.toLocaleString()} label={t('points_total_points')} />
        <StatPill icon={<Trophy className="w-4 h-4 text-emerald-500" />} value={rows[0]?.name || '—'} label={t('points_top_dept')} />
      </div>

      {/* Podium */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
          <Building2 className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-400">{t('points_no_depts')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <div className="flex items-end justify-center gap-4 md:gap-8">
            {second && <PodiumCard dept={second} rank={2} height="h-28" />}
            {first  && <PodiumCard dept={first}  rank={1} height="h-40" hero />}
            {third  && <PodiumCard dept={third}  rank={3} height="h-20" />}
          </div>

          {rest.length > 0 && (
            <div className="mt-8 space-y-2">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">{t('points_other_depts')}</p>
              {rest.map((d, i) => (
                <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50">
                  <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                    {i + 4}
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                    <p className="text-xs text-gray-400">{d.memberCount} {t('members_count')}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-600 tabular-nums">
                    <Star className="w-3.5 h-3.5" />
                    {d.total.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatPill({ icon, value, label }: { icon: React.ReactNode, value: string | number, label: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        <p className="text-[11px] text-gray-400">{label}</p>
      </div>
    </div>
  )
}

function PodiumCard({
  dept, rank, height, hero = false,
}: {
  dept: { id: string; name: string; total: number; memberCount: number }
  rank: 1 | 2 | 3
  height: string
  hero?: boolean
}) {
  const { t } = useLanguage()
  const tone = rank === 1
    ? { ring: 'ring-amber-300', bg: 'bg-gradient-to-br from-amber-100 to-amber-50', medal: 'bg-amber-500', crown: '👑' }
    : rank === 2
    ? { ring: 'ring-gray-300',  bg: 'bg-gradient-to-br from-gray-100 to-white',     medal: 'bg-gray-400',  crown: '🥈' }
    : { ring: 'ring-orange-300', bg: 'bg-gradient-to-br from-orange-100 to-orange-50', medal: 'bg-orange-500', crown: '🥉' }

  return (
    <div className="flex flex-col items-center text-center w-32 md:w-40">
      <div className="relative mb-2">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ring-4 ${tone.ring} ${tone.bg} ${hero ? 'scale-110' : ''}`}>
          <Building2 className="w-7 h-7 text-purple-600" />
        </div>
        <span className={`absolute -top-3 end-0 w-7 h-7 rounded-full ${tone.medal} text-white text-xs font-bold flex items-center justify-center shadow`}>
          {rank}
        </span>
      </div>
      <p className={`font-semibold truncate max-w-full ${hero ? 'text-base' : 'text-sm'} text-gray-900`}>{dept.name}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-600">
        <Star className="w-3 h-3" />{dept.total.toLocaleString()}
      </span>
      <p className="text-[10px] text-gray-400 mt-0.5">{dept.memberCount} {t('members_count')}</p>
      <div className={`mt-3 w-full ${height} rounded-t-xl ${tone.bg} flex items-start justify-center pt-2`}>
        <span className="text-2xl">{tone.crown}</span>
      </div>
    </div>
  )
}
