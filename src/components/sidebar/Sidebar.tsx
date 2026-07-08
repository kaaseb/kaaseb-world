'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Building2,
  CheckSquare,
  Bell,
  Settings,
  BarChart3,
  LogOut,
  Lock,
  Users,
  ClipboardList,
  BadgeCheck,
  Target,
  Bot,
  CalendarDays,
  Flame,
  Briefcase,
  Cookie,
  Package,
  FileBadge,
  FileSignature,
  Wand2,
  X,
  // ↓ kept-but-commented icons (Approvals/Points/Store/Ideas) — restore later when the features come back.
  // ShoppingBag,
  // MessageSquareHeart,
  // Lightbulb,
  // Star,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { hasPermission, type PermissionKey } from '@/lib/permissions'
import { ThemeToggle } from '@/components/sidebar/ThemeToggle'

interface SidebarProps {
  profile: Profile
  permissions?: string[]
  onLock?: () => void
  // Mobile drawer coordination. The shell owns the open/close state so the
  // top-bar burger and the sidebar agree on it; on desktop both props are
  // ignored because the sidebar is permanently visible.
  drawerOpen?: boolean
  onDrawerClose?: () => void
}

export function Sidebar({ profile, permissions, onLock, drawerOpen = false, onDrawerClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { t, lang, setLang, isRtl } = useLanguage()

  const can = (key: PermissionKey) => hasPermission(profile, permissions, key)

  const allItems: Array<{ href: string; icon: typeof LayoutDashboard; label: string; perm: PermissionKey }> = [
    { href: '/dashboard',          icon: LayoutDashboard, label: t('nav_home'),               perm: 'page.dashboard' },
    { href: '/calendar',           icon: CalendarDays,    label: t('nav_calendar'),           perm: 'page.calendar' },
    { href: '/projects',           icon: Briefcase,       label: t('nav_client_projects'),    perm: 'page.client_projects' },
    { href: '/furn',               icon: Flame,           label: t('nav_furn'),               perm: 'page.furn' },
    { href: '/tannoor',            icon: Cookie,          label: t('nav_tannoor'),            perm: 'page.tannoor' },
    { href: '/tannoor/products',   icon: Package,         label: t('nav_tannoor_products'),   perm: 'page.tannoor_products' },
    { href: '/important-docs',     icon: FileBadge,       label: t('nav_important_docs'),     perm: 'page.important_docs' },
    { href: '/pre-qualifications', icon: FileSignature,   label: t('nav_pre_qualifications'), perm: 'page.pre_qualifications' },
    { href: '/visualize',          icon: Wand2,           label: t('nav_visualize'),          perm: 'page.visualize' },
    { href: '/ai',                 icon: Bot,             label: t('nav_ghassl_ai'),          perm: 'page.ai' },
    { href: '/goals',              icon: Target,          label: t('nav_goals'),              perm: 'page.goals' },
    { href: '/departments',        icon: Building2,       label: t('nav_departments'),        perm: 'page.departments' },
    { href: '/daily-tasks',        icon: CheckSquare,     label: t('nav_daily_tasks'),        perm: 'page.daily_tasks' },
    { href: '/notifications',      icon: Bell,            label: t('nav_notifications'),      perm: 'page.notifications' },
    { href: '/analytics',          icon: BarChart3,       label: t('nav_analytics'),          perm: 'page.analytics' },
    { href: '/users',              icon: Users,           label: t('nav_users'),              perm: 'page.users' },
    { href: '/roles',              icon: BadgeCheck,      label: t('nav_roles'),              perm: 'page.roles' },
    { href: '/audit',              icon: ClipboardList,   label: t('nav_audit'),              perm: 'page.audit' },
    { href: '/settings',           icon: Settings,        label: t('nav_settings'),           perm: 'page.settings' },

    // ─── Hidden for now (kept for future re-enable) ─────────────────────────
    // { href: '/community',  icon: MessageSquareHeart, label: t('nav_community'),     perm: 'page.community' },
    // { href: '/ideas',      icon: Lightbulb,          label: t('nav_ideas'),         perm: 'page.idea_market' },
    // { href: '/points',     icon: Star,               label: t('nav_points'),        perm: 'page.points' },
    // { href: '/store',      icon: ShoppingBag,        label: t('nav_store'),         perm: 'page.store' },
    // { href: '/approvals',  icon: BadgeCheck,         label: t('nav_approvals'),     perm: 'page.approvals' },
    // ─── Removed entirely (App + Washhouses) ────────────────────────────────
  ]
  const navItems = allItems.filter(item => can(item.perm))

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    toast.success(t('signed_out'))
  }

  const roleLabel =
    profile.role === 'super_admin'
      ? t('role_super_admin')
      : profile.role === 'project_manager'
      ? t('role_project_manager')
      : t('role_employee')

  // RTL drawers slide from the right edge; LTR from the left. We translate
  // by 100% of the sidebar's own width in the start direction so the panel
  // is fully off-screen when closed and "slides in" when drawerOpen flips.
  const closedTransform = isRtl ? 'translate-x-full' : '-translate-x-full'

  // One markup tree handles both modes. md:* utilities override the mobile
  // behavior on tablet+ so the same component renders as either a fixed
  // sidebar or a dismissible drawer. Avoids duplicating the nav.
  return (
    <>
      {/* Backdrop — only rendered on mobile when the drawer is open. We
          fade pointer-events too so taps fall through to the underlying
          page once the panel finishes sliding out. */}
      <button
        type="button"
        aria-hidden={!drawerOpen}
        aria-label={t('close_menu')}
        onClick={onDrawerClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] transition-opacity duration-200 md:hidden',
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      />

      <aside
        data-sidebar
        dir={isRtl ? 'rtl' : 'ltr'}
        aria-hidden={!drawerOpen}
        className={cn(
          // Mobile: fixed off-canvas drawer, takes most of the viewport
          // width but caps at 320px so it never feels oversized on tablets.
          // 100dvh adapts to the iOS URL-bar swap so the panel always
          // touches the bottom edge.
          'fixed top-0 z-50 h-[100dvh] w-[85vw] max-w-[320px]',
          'bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden',
          'border-e border-sidebar-border shadow-2xl',
          'transition-transform duration-300 ease-out will-change-transform',
          drawerOpen ? 'translate-x-0' : closedTransform,
          // Anchor to the right edge in RTL, left in LTR.
          isRtl ? 'right-0' : 'left-0',
          // Desktop: drop the drawer behavior and become a sticky column.
          'md:static md:translate-x-0 md:h-screen md:w-[240px] md:max-w-none md:shadow-none md:sticky md:top-0'
        )}
      >
        {/* Top safe-area padding so iOS notch doesn't eat the logo. */}
        <div
          className="flex items-center justify-between gap-2 px-4 border-b border-sidebar-border"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))', paddingBottom: '0.75rem' }}
        >
          <img
            src="/kaaseb-logo.png"
            alt="Kaaseb"
            className="h-12 md:h-16 w-auto object-contain"
            loading="eager"
            decoding="async"
          />
          {/* Close affordance — mobile only; desktop sidebar is permanent. */}
          <button
            type="button"
            onClick={onDrawerClose}
            aria-label={t('close_menu')}
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-white/70 hover:text-white hover:bg-sidebar-accent transition-colors touch-manipulation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto overscroll-contain">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onDrawerClose}
                prefetch={isActive ? false : undefined}
                className={cn(
                  // 44px min height = native tap target. text-[15px] reads
                  // bigger on phones where the desktop xs feels cramped.
                  'flex items-center gap-3 px-3 min-h-11 py-2 rounded-lg text-[15px] md:text-sm font-medium transition-all duration-150 touch-manipulation',
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-white/75 hover:text-white hover:bg-sidebar-accent active:bg-sidebar-accent/80'
                )}
              >
                <Icon className={cn('w-5 h-5 md:w-4 md:h-4 flex-shrink-0', isActive ? 'text-white' : 'text-white/60')} />
                <span className="flex-1">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Language Toggle */}
        <div className="px-3 pb-1">
          <div className="flex items-center gap-1 bg-sidebar-accent rounded-lg p-1">
            <button
              onClick={() => setLang('en')}
              className={cn(
                'flex-1 text-xs font-medium py-1.5 rounded-md transition-all touch-manipulation',
                lang === 'en'
                  ? 'bg-sidebar-primary text-white'
                  : 'text-white/70 hover:text-white'
              )}
            >
              EN
            </button>
            <button
              onClick={() => setLang('ar')}
              className={cn(
                'flex-1 text-xs font-medium py-1.5 rounded-md transition-all touch-manipulation',
                lang === 'ar'
                  ? 'bg-sidebar-primary text-white'
                  : 'text-white/70 hover:text-white'
              )}
            >
              عربي
            </button>
          </div>
        </div>

        {/* User Section — extra bottom padding for the iOS home indicator. */}
        <div
          className="px-3 border-t border-sidebar-border pt-3 space-y-0.5"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {profile.lock_enabled && (
            <button
              onClick={onLock}
              className="w-full flex items-center gap-3 px-3 min-h-11 py-2 rounded-lg text-sm font-medium text-white/75 hover:text-white hover:bg-sidebar-accent transition-all duration-150 touch-manipulation"
            >
              <Lock className="w-4 h-4 text-white/60 flex-shrink-0" />
              <span className="flex-1 text-start">{t('lock_dashboard')}</span>
            </button>
          )}

          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-9 h-9 md:w-8 md:h-8 rounded-full bg-sidebar-accent flex items-center justify-center overflow-hidden flex-shrink-0">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <span className="text-white text-sm md:text-xs font-bold">
                  {(profile.full_name || profile.email || 'U')[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm md:text-xs font-medium truncate">
                {profile.full_name || 'User'}
              </p>
              <p className="text-white/60 text-xs truncate">{roleLabel}</p>
            </div>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="text-white/60 hover:text-red-400 transition-colors flex-shrink-0 p-1 -m-1 touch-manipulation"
              title={t('sign_out')}
              aria-label={t('sign_out')}
            >
              <LogOut className="w-4 h-4 md:w-3.5 md:h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
