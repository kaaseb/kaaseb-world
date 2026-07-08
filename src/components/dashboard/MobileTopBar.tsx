'use client'

import { Menu } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  onOpenDrawer: () => void
}

// Shown ONLY on screens < md. The desktop sidebar already serves as the
// header on larger displays, so we hide this to avoid double chrome.
//
// Layout: burger ⟷ logo. Single row, 56px tall — matches iOS/Android
// native nav-bar heights. sticky top-0 keeps it pinned while the page
// scrolls. backdrop-blur + translucent bg gives the same frosted feel
// the rest of the dashboard uses.
export function MobileTopBar({ onOpenDrawer }: Props) {
  const { t } = useLanguage()

  return (
    <header
      className="md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-3 border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 pt-[env(safe-area-inset-top)]"
      style={{ height: 'calc(3.5rem + env(safe-area-inset-top))' }}
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label={t('open_menu')}
        className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-foreground/80 hover:bg-muted active:bg-muted/80 transition-colors touch-manipulation"
      >
        <Menu className="w-5 h-5" />
      </button>

      <img
        src="/kaaseb-logo.png"
        alt="Kaaseb"
        className="h-9 w-auto object-contain"
        loading="eager"
        decoding="async"
      />
    </header>
  )
}
