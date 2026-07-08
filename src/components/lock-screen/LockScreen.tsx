'use client'

import { useState, useEffect, useCallback } from 'react'
import { Lock, Delete, Mail, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Profile } from '@/types'
import { t as translate, type Lang } from '@/lib/i18n/translations'

const PIN_LENGTH = 4

interface LockScreenProps {
  profile: Profile
  onUnlock: () => void
}

export function LockScreen({ profile, onUnlock }: LockScreenProps) {
  const [lang, setLangState] = useState<Lang>('en')
  const isRtl = lang === 'ar'
  const t = (key: Parameters<typeof translate>[0]) => translate(key, lang)

  useEffect(() => {
    const saved = localStorage.getItem('lock_lang') as Lang | null
    if (saved === 'ar' || saved === 'en') setLangState(saved)
  }, [])

  function toggleLang() {
    const next: Lang = lang === 'en' ? 'ar' : 'en'
    setLangState(next)
    localStorage.setItem('lock_lang', next)
  }

  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const verify = useCallback(async (code: string) => {
    setLoading(true)
    const response = await fetch('/api/lock/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: code }),
    })
    const result = await response.json()
    if (result.success) {
      onUnlock()
      toast.success(t('lock_unlock'))
    } else {
      setError(true)
      toast.error(t('lock_wrong_password'))
      setTimeout(() => { setPin(''); setError(false) }, 500)
    }
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUnlock])

  function handleDigit(digit: string) {
    if (loading || pin.length >= PIN_LENGTH) return
    const next = pin + digit
    setPin(next)
    setError(false)
    if (next.length === PIN_LENGTH) {
      verify(next)
    }
  }

  function handleBackspace() {
    if (loading) return
    setPin(prev => prev.slice(0, -1))
    setError(false)
  }

  // Keyboard support
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key)
      else if (e.key === 'Backspace') handleBackspace()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, loading])

  async function handleForgotPassword() {
    setSendingReset(true)
    const response = await fetch('/api/lock/forgot', { method: 'POST' })
    const result = await response.json()
    if (result.success) toast.success(t('lock_reset_sent'))
    else toast.error(t('lock_reset_failed'))
    setSendingReset(false)
  }

  const locale = lang === 'ar' ? 'ar-SA' : 'en-US'

  const formatTime = (date: Date) =>
    date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true })

  const formatDate = (date: Date) =>
    date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Language toggle */}
      <button
        onClick={toggleLang}
        className="absolute top-4 end-4 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors z-20"
      >
        {lang === 'en' ? 'العربية' : 'English'}
      </button>

      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
          backgroundSize: '40px 40px'
        }} />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-xs px-6">
        {/* Time Display */}
        <div className="text-center mb-8" suppressHydrationWarning>
          <div className="text-5xl font-light text-white tracking-tight mb-1">
            {formatTime(currentTime)}
          </div>
          <div className="text-slate-400 text-base">
            {formatDate(currentTime)}
          </div>
        </div>

        {/* User Avatar */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur border-2 border-white/20 flex items-center justify-center mb-2 overflow-hidden">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-white">
                {(profile.full_name || profile.email || 'U')[0].toUpperCase()}
              </span>
            )}
          </div>
          <h2 className="text-white text-lg font-semibold">
            {profile.full_name || profile.email}
          </h2>
          <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            {t('lock_enter_password')}
          </p>
        </div>

        {/* PIN Dots */}
        <div className={`flex gap-4 mb-8 ${error ? 'animate-shake' : ''}`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                error
                  ? 'border-red-400 bg-red-400'
                  : i < pin.length
                    ? 'border-white bg-white scale-110'
                    : 'border-slate-500 bg-transparent'
              }`}
            />
          ))}
        </div>

        {/* Loading indicator */}
        {loading && (
          <div className="mb-4">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        )}

        {/* Number Pad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'].map((key) => {
            if (key === '') return <div key="empty" />
            if (key === 'back') {
              return (
                <button
                  key="back"
                  type="button"
                  onClick={handleBackspace}
                  disabled={loading}
                  className="h-16 rounded-2xl flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 transition-colors disabled:opacity-40"
                >
                  <Delete className="w-6 h-6" />
                </button>
              )
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleDigit(key)}
                disabled={loading}
                className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-2xl font-light transition-colors disabled:opacity-40"
              >
                {key}
              </button>
            )
          })}
        </div>

        {/* Forgot Password */}
        <button
          onClick={handleForgotPassword}
          disabled={sendingReset}
          className="mt-6 text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-2"
        >
          {sendingReset ? (
            <><Loader2 className="w-3 h-3 animate-spin" />{t('loading')}</>
          ) : (
            <><Mail className="w-3 h-3" />{t('lock_forgot')}</>
          )}
        </button>
      </div>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  )
}
