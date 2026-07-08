'use client'

import { useState } from 'react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { Star, Wallet, Trophy, Building2, ShieldAlert } from 'lucide-react'
import type { LedgerEntry, DepartmentWithMembers } from '@/app/(dashboard)/points/page'
import { PointsMyBalanceTab } from './PointsMyBalanceTab'
import { PointsLeadersTab } from './PointsLeadersTab'
import { PointsDepartmentsTab } from './PointsDepartmentsTab'
import { PointsManagementTab } from './PointsManagementTab'

type Tab = 'mine' | 'leaders' | 'departments' | 'manage'

interface Props {
  profile: Profile
  allProfiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points' | 'role'>[]
  departments: DepartmentWithMembers[]
  initLedger: LedgerEntry[]
}

export function PointsClient({ profile, allProfiles, departments, initLedger }: Props) {
  const { t, isRtl } = useLanguage()
  const isSuperAdmin = profile.role === 'super_admin'
  const [tab, setTab] = useState<Tab>('mine')

  const tabs: Array<{ key: Tab, label: string, icon: React.ReactNode, color: string }> = [
    { key: 'mine',        label: t('points_tab_mine'),        icon: <Wallet className="w-4 h-4" />,   color: 'text-blue-600' },
    { key: 'leaders',     label: t('points_tab_leaders'),     icon: <Trophy className="w-4 h-4" />,   color: 'text-amber-600' },
    { key: 'departments', label: t('points_tab_departments'), icon: <Building2 className="w-4 h-4" />, color: 'text-purple-600' },
    ...(isSuperAdmin ? [{ key: 'manage' as Tab, label: t('points_tab_manage'), icon: <ShieldAlert className="w-4 h-4" />, color: 'text-blue-600' }] : []),
  ]

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header with title + tab pills */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Star className="w-6 h-6 text-amber-500 fill-amber-400" />
          {t('points_title')}
        </h1>
        <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full p-1">
          {tabs.map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                tab === tb.key
                  ? 'bg-white shadow-sm text-gray-900 ring-1 ring-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className={tab === tb.key ? tb.color : ''}>{tb.icon}</span>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'mine' && (
        <PointsMyBalanceTab
          profile={profile}
          allProfiles={allProfiles}
          ledger={initLedger}
        />
      )}
      {tab === 'leaders' && (
        <PointsLeadersTab
          profiles={allProfiles}
          ledger={initLedger}
          departments={departments}
        />
      )}
      {tab === 'departments' && (
        <PointsDepartmentsTab departments={departments} />
      )}
      {tab === 'manage' && isSuperAdmin && (
        <PointsManagementTab
          currentUser={profile}
          profiles={allProfiles}
          initLedger={initLedger}
        />
      )}
    </div>
  )
}
