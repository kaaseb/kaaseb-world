'use client'

// Per-quote Terms & Conditions control, reused by the Furn / Tannoor / manual
// screens. Lets one quote: include the T&C or not, pick its language (auto =
// follow the PDF's language), and override the bullet lines. Saved to the S3
// override store keyed `<scope>:<id>`.
//
// AUTO-SAVE + FLUSH (the owner's "stupid thing we did"): the PDF is rendered
// from the SAVED override, so an edit that was never saved — or a quotation
// generated before the terms were touched — silently shipped without them.
// Every change is now saved automatically (debounced), and the surfaces call
// `flush()` through the ref right before generating/printing, so what you see
// in this box is exactly what the customer gets. The Save button stays as an
// explicit "now" for people who like pressing it.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Check, Loader2, ScrollText, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type LangSel = 'auto' | 'ar' | 'en'
type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface QuoteTermsHandle {
  /** Persist any pending edit NOW. Resolves true when nothing was pending or the save succeeded. */
  flush: () => Promise<boolean>
}

interface Props { scopeKey: string; uiAr: boolean; quoteLang: 'ar' | 'en' }

const AUTOSAVE_MS = 700

export const QuoteTermsControl = forwardRef<QuoteTermsHandle, Props>(function QuoteTermsControl({ scopeKey, uiAr, quoteLang }, ref) {
  const tx = (a: string, e: string) => (uiAr ? a : e)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<Status>('idle')
  const [enabled, setEnabled] = useState(false)
  const [lang, setLang] = useState<LangSel>('auto')
  const [text, setText] = useState('')
  const [placeholder, setPlaceholder] = useState<{ ar: string; en: string }>({ ar: '', en: '' })

  // The values a save must use. Written only from event handlers / the loader
  // (never during render) so the debounced save and flush() always see the
  // latest edit, not a stale closure.
  const latest = useRef({ enabled: false, lang: 'auto' as LangSel, text: '', placeholder: { ar: '', en: '' } })
  const quoteLangRef = useRef(quoteLang)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)
  const inflight = useRef<Promise<boolean> | null>(null)

  useEffect(() => { quoteLangRef.current = quoteLang }, [quoteLang])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [gRes, oRes] = await Promise.all([
          fetch('/api/quote-terms'),
          fetch(`/api/quote-terms/override?key=${encodeURIComponent(scopeKey)}`),
        ])
        const g = await gRes.json().catch(() => ({}))
        const o = await oRes.json().catch(() => ({}))
        if (!alive) return
        const global = g.terms || { ar: [], en: [], defaultEnabled: false }
        const ph = { ar: (global.ar || []).join('\n'), en: (global.en || []).join('\n') }
        const ov = o.override
        const lang0: LangSel = ov?.lang === 'ar' || ov?.lang === 'en' ? ov.lang : 'auto'
        const effLang0 = lang0 === 'auto' ? quoteLangRef.current : lang0
        const enabled0 = ov?.enabled ?? !!global.defaultEnabled
        // Pre-fill the box with the ACTUAL terms — the per-quote override if any,
        // else the settings default for the language — so it's visible + editable.
        const text0 = (ov?.terms && ov.terms.length ? ov.terms : (effLang0 === 'ar' ? global.ar : global.en)).join('\n')
        latest.current = { enabled: enabled0, lang: lang0, text: text0, placeholder: ph }
        setPlaceholder(ph)
        setEnabled(enabled0)
        setLang(lang0)
        setText(text0)
      } catch { /* ignore */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [scopeKey])

  async function doSave(): Promise<boolean> {
    const { enabled, lang, text, placeholder } = latest.current
    setStatus('saving')
    try {
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
      // If the text still equals the settings default, store no override (null) so
      // this quote keeps following the global default; only real edits are saved.
      const effLang = lang === 'auto' ? quoteLangRef.current : lang
      const defLines = (effLang === 'ar' ? placeholder.ar : placeholder.en).split('\n').map((s) => s.trim()).filter(Boolean)
      const same = lines.length === defLines.length && lines.every((l, i) => l === defLines[i])
      const termsToSave = lines.length && !same ? lines : null
      const res = await fetch('/api/quote-terms/override', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: scopeKey, enabled, lang: lang === 'auto' ? null : lang, terms: termsToSave }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setStatus('error'); toast.error(j.error || tx('فشل حفظ الشروط', 'Failed to save terms')); return false }
      dirty.current = false
      setStatus('saved')
      return true
    } catch {
      setStatus('error')
      toast.error(tx('فشل حفظ الشروط', 'Failed to save terms'))
      return false
    }
  }

  /** Save now if anything is pending; coalesces concurrent callers. */
  function saveNow(): Promise<boolean> {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!dirty.current) return inflight.current ?? Promise.resolve(true)
    if (!inflight.current) inflight.current = doSave().finally(() => { inflight.current = null })
    return inflight.current
  }

  function queueSave() {
    dirty.current = true
    setStatus('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void saveNow() }, AUTOSAVE_MS)
  }

  function update(patch: Partial<{ enabled: boolean; lang: LangSel; text: string }>) {
    latest.current = { ...latest.current, ...patch }
    if (patch.enabled !== undefined) setEnabled(patch.enabled)
    if (patch.lang !== undefined) setLang(patch.lang)
    if (patch.text !== undefined) setText(patch.text)
    queueSave()
  }

  useImperativeHandle(ref, () => ({ flush: saveNow }))

  if (loading) return null

  const effLang = lang === 'auto' ? quoteLang : lang
  const ph = (effLang === 'ar' ? placeholder.ar : placeholder.en) || tx('نقطة لكل سطر…', 'One bullet per line…')

  const statusLine =
    status === 'saving' ? <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />{tx('يُحفظ…', 'Saving…')}</span>
    : status === 'saved' ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><Check className="w-3 h-3" />{tx('محفوظ — سيظهر في العرض', 'Saved — will appear on the quote')}</span>
    : status === 'dirty' ? <span className="text-[11px] text-amber-700">{tx('تغييرات غير محفوظة… (تُحفظ تلقائيًا)', 'Unsaved changes… (auto-saving)')}</span>
    : status === 'error' ? <span className="text-[11px] text-red-600">{tx('لم يُحفظ — أعد المحاولة', 'Not saved — retry')}</span>
    : null

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-white" dir={uiAr ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold flex items-center gap-1.5"><ScrollText className="w-4 h-4 text-indigo-600" />{tx('الشروط والأحكام', 'Terms & Conditions')}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={enabled} onChange={(e) => update({ enabled: e.target.checked })} className="accent-indigo-600" />{tx('أدرج في العرض', 'Include')}</label>
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {(['auto', 'ar', 'en'] as const).map((l) => (
              <button key={l} type="button" onClick={() => {
                // Switching language re-pulls that language's default text UNLESS the
                // user already edited the box (text differs from the old default).
                const oldEff = lang === 'auto' ? quoteLang : lang
                const oldDefault = (oldEff === 'ar' ? placeholder.ar : placeholder.en).trim()
                const newEff = l === 'auto' ? quoteLang : l
                const patch: Partial<{ lang: LangSel; text: string }> = { lang: l }
                if (text.trim() === oldDefault) patch.text = newEff === 'ar' ? placeholder.ar : placeholder.en
                update(patch)
              }} className={`px-2 py-0.5 rounded ${lang === l ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>
                {l === 'auto' ? tx('تلقائي', 'Auto') : l === 'ar' ? 'عربي' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <textarea value={text} onChange={(e) => update({ text: e.target.value })} onBlur={() => { void saveNow() }} rows={4} dir={effLang === 'ar' ? 'rtl' : 'ltr'}
        placeholder={ph}
        className="w-full rounded-md border px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-400" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => update({ text: effLang === 'ar' ? placeholder.ar : placeholder.en })}
            className="text-[11px] text-indigo-600 hover:underline">
            {tx('استرجاع النص من الإعدادات', 'Reset text from settings')}
          </button>
          {statusLine}
        </div>
        <Button size="sm" onClick={() => { void saveNow() }} disabled={status === 'saving'} className="gap-1.5">
          {status === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{tx('حفظ', 'Save')}
        </Button>
      </div>
    </div>
  )
})
