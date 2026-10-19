'use client'

// The floating كاسب AI button, mounted app-wide. Only the button ships with
// every page — the chat itself is a separate chunk loaded on first open.
// Mobile: full-screen panel (the keyboard never covers the composer).
// Desktop: a corner card. Stacks above the project-chat button when both show.

import { lazy, Suspense, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

const KaasebAiChat = lazy(() => import('./KaasebAiChat').then((m) => ({ default: m.KaasebAiChat })))

export function KaasebAiLauncher({ firstName, stacked }: { firstName: string; stacked: boolean }) {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The full page already is the assistant.
  if (pathname === '/ai') return null

  const label = ar ? 'كاسب AI' : 'Kaaseb AI'
  return (
    <>
      {!open && (
        <button
          onClick={() => { setOpen(true); setEverOpened(true) }}
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`fixed end-5 z-40 group h-14 w-14 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-700 text-white shadow-lg shadow-indigo-900/30 ring-1 ring-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform ${stacked ? 'bottom-[5.5rem]' : 'bottom-5'}`}
          aria-label={label}
          title={label}
        >
          <Sparkles className="w-6 h-6" />
          <span className="absolute -top-1 -end-1 w-3 h-3 rounded-full bg-sky-400 ring-2 ring-background" />
        </button>
      )}
      {everOpened && (
        <div
          className={`fixed z-50 inset-0 h-[100dvh] sm:inset-auto sm:bottom-5 sm:end-5 sm:h-[680px] sm:max-h-[88vh] sm:w-[440px] sm:rounded-2xl sm:shadow-2xl sm:border overflow-hidden bg-background ${open ? '' : 'hidden'}`}
          role="dialog"
          aria-label={label}
          onClickCapture={(e) => {
            // Phone: the panel is full screen — following an in-app link (تعديل،
            // فتح المشروع) must reveal that page, so the panel steps aside.
            const a = (e.target as HTMLElement).closest('a')
            if (a && a.getAttribute('target') !== '_blank' && a.getAttribute('href')?.startsWith('/') && window.innerWidth < 640) setOpen(false)
          }}
        >
          <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
            <KaasebAiChat mode="panel" firstName={firstName} onClose={() => setOpen(false)} />
          </Suspense>
        </div>
      )}
    </>
  )
}
