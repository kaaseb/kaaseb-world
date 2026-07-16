'use client'

// The first thing you see on the dashboard: what the robot found while you slept.
//
// This exists because the scout is worthless if nobody opens it. The number of
// UNWORKED high-score leads is the one metric that should nag you, so it's the
// big number here — not the total, which only ever grows and stops meaning
// anything.

import Link from 'next/link'
import { Radar, Building, ArrowLeft, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/LanguageContext'

export interface ScoutStats {
  oppActive: number // leads nobody has called yet
  oppHot: number // …of those, score >= 80
  companiesActive: number
  companiesHot: number
}

export function ScoutSummary({ stats, canOpp, canCompanies }: {
  stats: ScoutStats
  canOpp: boolean
  canCompanies: boolean
}) {
  const { t, isRtl } = useLanguage()
  if (!canOpp && !canCompanies) return null

  const Arrow = isRtl ? ArrowLeft : ArrowRight

  return (
    <div className={cn('grid gap-4 mb-6', canOpp && canCompanies ? 'sm:grid-cols-2' : 'grid-cols-1')}>
      {canOpp && (
        <Link
          href="/opportunities"
          className="group bg-white rounded-2xl border border-gray-100 p-5 hover:border-teal-300 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-sm">
                <Radar className="w-4.5 h-4.5 text-white" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('opp_title')}</h3>
            </div>
            <Arrow className="w-4 h-4 text-gray-300 group-hover:text-teal-600 transition-colors" />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-3xl font-bold text-teal-600 leading-none">{stats.oppActive}</p>
              <p className="text-[11px] text-gray-600 mt-1">{t('scout_waiting')}</p>
            </div>
            {stats.oppHot > 0 && (
              <div className="pb-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  🔥 {stats.oppHot} {t('scout_hot')}
                </span>
              </div>
            )}
          </div>
        </Link>
      )}

      {canCompanies && (
        <Link
          href="/companies"
          className="group bg-white rounded-2xl border border-gray-100 p-5 hover:border-indigo-300 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center shadow-sm">
                <Building className="w-4.5 h-4.5 text-white" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">{t('co_title')}</h3>
            </div>
            <Arrow className="w-4 h-4 text-gray-300 group-hover:text-indigo-600 transition-colors" />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-3xl font-bold text-indigo-600 leading-none">{stats.companiesActive}</p>
              <p className="text-[11px] text-gray-600 mt-1">{t('scout_waiting')}</p>
            </div>
            {stats.companiesHot > 0 && (
              <div className="pb-0.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                  🔥 {stats.companiesHot} {t('scout_hot')}
                </span>
              </div>
            )}
          </div>
        </Link>
      )}
    </div>
  )
}
