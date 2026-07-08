'use client'

import { useMemo, useState, useEffect } from 'react'
import { Crown, Medal, Zap, Trophy, Calendar } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import type { LedgerEntry, DepartmentWithMembers } from '@/app/(dashboard)/points/page'

interface Props {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points' | 'role'>[]
  ledger: LedgerEntry[]
  departments: DepartmentWithMembers[]
}

export function PointsLeadersTab({ profiles, ledger, departments }: Props) {
  const { t } = useLanguage()
  const [deptFilter, setDeptFilter] = useState<string>('')
  const [mountedMs, setMountedMs] = useState<number | null>(null)

  useEffect(() => { setMountedMs(Date.now()) }, [])

  // Which user_ids are in the selected department (if any)
  const allowedUserIds = useMemo(() => {
    if (!deptFilter) return null
    const dept = departments.find(d => d.id === deptFilter)
    return new Set((dept?.department_members || []).map(m => m.user_id))
  }, [deptFilter, departments])

  const filteredProfiles = useMemo(
    () => allowedUserIds ? profiles.filter(p => allowedUserIds.has(p.id)) : profiles,
    [profiles, allowedUserIds],
  )

  // Time-windowed leaders (from ledger of approved entries, optionally restricted by dept)
  const { top: topToday }  = useMemo(() => topWithinWindow(ledger, mountedMs, 24 * 60 * 60 * 1000, allowedUserIds, profiles), [ledger, mountedMs, allowedUserIds, profiles])
  const { top: topWeek }   = useMemo(() => topWithinWindow(ledger, mountedMs, 7 * 24 * 60 * 60 * 1000, allowedUserIds, profiles), [ledger, mountedMs, allowedUserIds, profiles])
  const { top: topMonth }  = useMemo(() => topWithinWindow(ledger, mountedMs, 30 * 24 * 60 * 60 * 1000, allowedUserIds, profiles), [ledger, mountedMs, allowedUserIds, profiles])

  const ranked = useMemo(() => [...filteredProfiles].sort((a, b) => b.total_points - a.total_points), [filteredProfiles])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Crown className="w-5 h-5 text-amber-500" />{t('points_heroes')}
        </h2>
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm"
        >
          <option value="">{t('points_filter_all_depts')}</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Top 3 windows */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HeroCard
          label={t('points_hero_today')}
          icon={<Zap className="w-4 h-4" />}
          user={topToday}
          tone="sky"
          windowKnown={mountedMs != null}
        />
        <HeroCard
          label={t('points_hero_week')}
          icon={<Medal className="w-4 h-4" />}
          user={topWeek}
          tone="blue"
          windowKnown={mountedMs != null}
        />
        <HeroCard
          label={t('points_hero_month')}
          icon={<Crown className="w-4 h-4" />}
          user={topMonth}
          tone="amber"
          windowKnown={mountedMs != null}
        />
      </div>

      {/* General ranking */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-5 flex items-center gap-2 border-b border-gray-100">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t('points_general_ranking')}</h3>
          {deptFilter && (
            <span className="ms-auto text-xs font-medium bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
              {departments.find(d => d.id === deptFilter)?.name}
            </span>
          )}
        </div>
        {ranked.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4" />{t('points_ranking_empty')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {ranked.map((u, i) => (
              <li key={u.id} className="px-5 py-3 flex items-center gap-3">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  i === 0 ? 'bg-amber-100 text-amber-700' :
                  i === 1 ? 'bg-gray-100 text-gray-700' :
                  i === 2 ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-50 text-gray-500'
                }`}>
                  {i + 1}
                </span>
                <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xs font-bold text-gray-500">{(u.full_name || u.email || 'U')[0].toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-600 tabular-nums">
                  <Zap className="w-3.5 h-3.5" />
                  {u.total_points.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HeroCard({
  label, icon, user, tone, windowKnown,
}: {
  label: string
  icon: React.ReactNode
  user: { id: string; full_name: string | null; email: string | null; avatar_url: string | null; points: number } | null
  tone: 'sky' | 'blue' | 'amber'
  windowKnown: boolean
}) {
  const { t } = useLanguage()
  const tones = {
    sky:   { headerText: 'text-sky-600',   fromBg: 'from-sky-50',   medalBg: 'bg-sky-100 text-sky-700' },
    blue:  { headerText: 'text-blue-600',  fromBg: 'from-blue-50',  medalBg: 'bg-blue-100 text-blue-700' },
    amber: { headerText: 'text-amber-600', fromBg: 'from-amber-50', medalBg: 'bg-amber-100 text-amber-700' },
  } as const
  const s = tones[tone]

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${s.fromBg} via-white to-white border border-gray-100 p-5`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${s.headerText}`}>
        {icon}{label}
      </div>
      {!windowKnown ? (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400">—</div>
      ) : user ? (
        <div className="mt-4 flex flex-col items-center">
          <div className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center ring-4 ring-white ${s.medalBg}`}>
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span className="text-lg font-bold">{(user.full_name || user.email || 'U')[0].toUpperCase()}</span>}
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-2 text-center truncate max-w-full">
            {user.full_name || user.email?.split('@')[0]}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold bg-white px-2.5 py-1 rounded-full border border-gray-100">
            <Zap className="w-3 h-3 text-amber-500" />{user.points} {t('points_unit')}
          </span>
        </div>
      ) : (
        <div className="h-28 flex items-center justify-center text-center text-xs text-gray-400">
          {t('points_hero_empty')}
        </div>
      )}
    </div>
  )
}

function topWithinWindow(
  ledger: LedgerEntry[],
  nowMs: number | null,
  windowMs: number,
  allowedUserIds: Set<string> | null,
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[],
) {
  if (nowMs == null) return { top: null }
  const since = nowMs - windowMs
  const sums = new Map<string, number>()
  for (const l of ledger) {
    if (l.status !== 'approved' || !l.user_id) continue
    if (allowedUserIds && !allowedUserIds.has(l.user_id)) continue
    if (new Date(l.created_at).getTime() < since) continue
    sums.set(l.user_id, (sums.get(l.user_id) || 0) + (l.points || 0))
  }
  let bestId: string | null = null
  let bestPts = 0
  for (const [id, pts] of sums) {
    if (pts > bestPts) { bestPts = pts; bestId = id }
  }
  if (!bestId) return { top: null }
  const p = profiles.find(u => u.id === bestId)
  if (!p) return { top: null }
  return { top: { id: p.id, full_name: p.full_name, email: p.email, avatar_url: p.avatar_url, points: bestPts } }
}
