'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { t as translate, type Lang, type TranslationKey } from '@/lib/i18n/translations'

interface LanguageContextValue {
  lang: Lang
  isRtl: boolean
  t: (key: TranslationKey) => string
  setLang: (lang: Lang) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  isRtl: false,
  t: (key) => key,
  setLang: () => {},
})

export function LanguageProvider({
  children,
  initialLang,
  userId,
}: {
  children: React.ReactNode
  initialLang: Lang
  userId: string
}) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const supabase = createClient()

  const isRtl = lang === 'ar'

  // Apply dir + lang to document
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
  }, [lang, isRtl])

  const setLang = useCallback(async (newLang: Lang) => {
    setLangState(newLang)
    // Persist to profile (any user can update their own language — RLS: id = auth.uid())
    if (userId) {
      await supabase.from('profiles').update({ language: newLang }).eq('id', userId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const tFn = useCallback((key: TranslationKey) => translate(key, lang), [lang])

  return (
    <LanguageContext.Provider value={{ lang, isRtl, t: tFn, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
