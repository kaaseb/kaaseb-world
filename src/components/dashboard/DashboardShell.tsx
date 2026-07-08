'use client'

import { useState, useEffect, lazy, Suspense } from 'react'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { MobileTopBar } from '@/components/dashboard/MobileTopBar'
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'
import type { Lang } from '@/lib/i18n/translations'
import { useSearchParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'

// Lock screen + presence heartbeat aren't on the critical path. Loading them
// lazily shaves their JS off the initial mobile bundle — the dashboard paints
// faster on 4G/Edge, and these mount when actually needed.
const LockScreen = lazy(() =>
  import('@/components/lock-screen/LockScreen').then(m => ({ default: m.LockScreen }))
)
const PresenceHeartbeat = lazy(() =>
  import('@/components/presence/PresenceHeartbeat').then(m => ({ default: m.PresenceHeartbeat }))
)

interface DashboardShellProps {
  profile: Profile
  permissions?: string[]
  children: React.ReactNode
}

// Inner shell that has access to LanguageContext
function DashboardInner({ profile, permissions, children }: DashboardShellProps) {
  const { isRtl } = useLanguage()
  const [isLocked, setIsLocked] = useState(false)
  const [mounted, setMounted] = useState(false)
  // Mobile drawer state. Lives in the shell (not inside Sidebar) so the
  // top-bar burger and the sidebar share one source of truth.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Defer mounting the presence heartbeat until the browser is idle —
  // otherwise its fetches contend with the dashboard's own data queries.
  const [presenceReady, setPresenceReady] = useState(false)
  const searchParams = useSearchParams()
  const pathname = usePathname()

  useEffect(() => {
    setMounted(true)
    if (profile?.lock_enabled) {
      const unlocked = sessionStorage.getItem(`unlocked_${profile.id}`)
      if (!unlocked) setIsLocked(true)
    }
    if (searchParams.get('unlock') === 'success') {
      setIsLocked(false)
      if (profile?.id) sessionStorage.setItem(`unlocked_${profile.id}`, 'true')
      toast.success('Dashboard lock has been reset successfully!')
    }
    if (profile?.role === 'super_admin' && !sessionStorage.getItem('dues_checked')) {
      sessionStorage.setItem('dues_checked', '1')
      fetch('/api/notifications/dues-check', { method: 'POST' }).catch(() => {})
    }
  }, [profile?.id, profile?.lock_enabled, profile?.role, searchParams])

  // Schedule presence after the page is interactive. requestIdleCallback
  // is supported in modern Chromium/Firefox; the timeout-based fallback
  // covers Safari.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => void }
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => setPresenceReady(true))
    } else {
      const id = window.setTimeout(() => setPresenceReady(true), 1500)
      return () => window.clearTimeout(id)
    }
  }, [])

  // Auto-close drawer on route change so navigating from a nav item dismisses
  // the overlay without a second tap.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Lock body scroll behind the open drawer — without this iOS happily
  // scrolls the dashboard underneath when the user drags inside the menu.
  useEffect(() => {
    if (!drawerOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [drawerOpen])

  function handleUnlock() {
    setIsLocked(false)
    sessionStorage.setItem(`unlocked_${profile.id}`, 'true')
  }

  function handleLock() {
    setIsLocked(true)
    sessionStorage.removeItem(`unlocked_${profile.id}`)
  }

  return (
    <div
      data-app-shell
      className="flex min-h-[100dvh] bg-background text-foreground"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {mounted && isLocked && profile.lock_enabled && (
        <Suspense fallback={null}>
          <LockScreen profile={profile} onUnlock={handleUnlock} />
        </Suspense>
      )}

      <Sidebar
        profile={profile}
        permissions={permissions}
        onLock={handleLock}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <MobileTopBar onOpenDrawer={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-auto min-w-0">
          {children}
        </main>
      </div>

      {presenceReady && (
        <Suspense fallback={null}>
          <PresenceHeartbeat userId={profile.id} />
        </Suspense>
      )}
    </div>
  )
}

export function DashboardShell({ profile, permissions, children }: DashboardShellProps) {
  const initialLang: Lang = profile.language === 'ar' ? 'ar' : 'en'

  return (
    <LanguageProvider initialLang={initialLang} userId={profile.id}>
      <DashboardInner profile={profile} permissions={permissions}>{children}</DashboardInner>
    </LanguageProvider>
  )
}
