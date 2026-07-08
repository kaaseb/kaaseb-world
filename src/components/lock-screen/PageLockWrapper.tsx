'use client'

import { useState } from 'react'
import { LockScreen } from '@/components/lock-screen/LockScreen'
import type { Profile } from '@/types'

interface PageLockWrapperProps {
  profile: Profile
  pageKey: string
  children: React.ReactNode
}

export function PageLockWrapper({ profile, pageKey, children }: PageLockWrapperProps) {
  const [isLocked, setIsLocked] = useState(true)

  // Always lock if user has a lock password set, regardless of lock_enabled
  if (isLocked && profile.lock_password_hash) {
    return (
      <LockScreen
        profile={profile}
        onUnlock={() => setIsLocked(false)}
      />
    )
  }

  return <>{children}</>
}
