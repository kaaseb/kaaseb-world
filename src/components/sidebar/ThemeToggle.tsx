'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

// Sidebar dark-mode toggle. Compact icon button to sit next to the sign-out
// button. Hides until mounted to avoid the next-themes hydration mismatch
// (server doesn't know which theme to render).
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useLanguage()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return <div className="w-3.5 h-3.5" aria-hidden />
  }

  const isDark = resolvedTheme === 'dark'
  const label = isDark ? t('theme_light') : t('theme_dark')

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="text-white/70 hover:text-white transition-colors flex-shrink-0"
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  )
}
