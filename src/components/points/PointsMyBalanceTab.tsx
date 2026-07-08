'use client'

import { useMemo } from 'react'
import { Zap, Trophy, Award, Star, History, Info, TrendingUp, TrendingDown } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeAgo } from '@/components/ui/time-ago'
import { levelFor, nextLevelOf } from './levels'
import type { LedgerEntry } from '@/app/(dashboard)/points/page'

interface Props {
  profile: Profile
  allProfiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points' | 'role'>[]
  ledger: LedgerEntry[]
}

export function PointsMyBalanceTab({ profile, allProfiles, ledger }: Props) {
  const { t, lang } = useLanguage()

  const myLedger = useMemo(() => ledger.filter(l => l.user_id === profile.id && l.status === 'approved'), [ledger, profile.id])
  const totalEarned = myLedger.reduce((sum, l) => sum + (l.points || 0), 0)
  const available = profile.total_points
  const level = levelFor(profile.total_points)
  const next = nextLevelOf(profile.total_points)
  const progressToNext = next ? Math.min(100, Math.floor(((profile.total_points - level.min) / (next.min - level.min)) * 100)) : 100

  const sorted = [...allProfiles].sort((a, b) => b.total_points - a.total_points)
  const myIndex = sorted.findIndex(p => p.id === profile.id)
  const myRank = myIndex >= 0 ? myIndex + 1 : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Earned points (gradient hero) */}
        <div className="lg:col-span-2 rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 text-white p-6 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/90 text-sm">
              <Zap className="w-4 h-4" />
              {t('points_total_earned')}
            </div>
            <p className="text-5xl font-bold mt-2">{totalEarned.toLocaleString()}</p>
            <p className="text-white/80 text-sm mt-1">{t('points_unit')}</p>

            <div className="mt-6 space-y-3">
              <div className="inline-flex items-center gap-1.5 text-xs bg-white/15 rounded-full px-3 py-1.5 backdrop-blur">
                <Star className="w-3.5 h-3.5 fill-amber-300 text-amber-300" />
                <span>{t('points_available')}:</span>
                <span className="font-bold">{available.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 text-xs bg-black/20 rounded-full px-3 py-1.5 backdrop-blur inline-flex">
                <Award className="w-3.5 h-3.5" />
                <span>{t('points_current_level')}:</span>
                <span className="font-bold">{lang === 'ar' ? level.label_ar : level.label_en}</span>
              </div>
              {next && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-white/80 mb-1">
                    <span>{lang === 'ar' ? level.label_ar : level.label_en}</span>
                    <span>{lang === 'ar' ? next.label_ar : next.label_en}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${progressToNext}%` }} />
                  </div>
                  <p className="text-[10px] text-white/70 mt-1">
                    {next.min - profile.total_points} {t('points_to_next')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rank */}
        <div className="rounded-2xl bg-white border border-gray-100 p-6 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center mb-3">
            <Trophy className="w-7 h-7 text-amber-600" />
          </div>
          <p className="text-xs text-gray-500">{t('points_rank_label')}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {myRank ? `#${myRank}` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {t('points_rank_out_of').replace('{n}', String(allProfiles.length))}
          </p>
        </div>
      </div>

      {/* Log */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-5 flex items-center gap-2 border-b border-gray-100">
          <History className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">{t('points_log_title')}</h3>
        </div>
        {myLedger.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
            <Info className="w-5 h-5 text-gray-300" />
            {t('points_log_empty')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {myLedger.map(l => {
              const positive = l.points >= 0
              return (
                <li key={l.id} className="px-5 py-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    positive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}>
                    {positive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{l.object_name || labelForAction(l.action_type)}</p>
                    <TimeAgo iso={l.created_at} className="text-xs text-gray-400" />
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {positive ? '+' : ''}{l.points}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function labelForAction(action: string): string {
  const map: Record<string, string> = {
    task_completed: 'Task completed',
    manual_grant: 'Manual grant',
    manual_deduct: 'Manual deduction',
  }
  return map[action] ?? action
}
