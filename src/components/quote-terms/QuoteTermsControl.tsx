'use client'

// Per-quote Terms & Conditions control, reused by the Furn / Tannoor / manual
// screens — the owner's spec, verbatim from his voice note:
//
//   • under the delivery choice: "هل تريد الشروط والأحكام؟ نعم / لا"
//   • لا  → nothing is printed.
//   • نعم → the terms from Settings are used as they are…
//   • …and an «عدّل» button opens a POPUP with those terms, editable for THIS
//     quote only (the Settings text is never touched).
//
// AUTO-SAVE + FLUSH: the PDF is rendered from the SAVED override, so every
// change here is saved automatically (debounced, and on closing the popup),
// and the surfaces call `flush()` through the ref right before generating /
// printing — what you decided here is exactly what the customer gets.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Check, Loader2, Pencil, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

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
  const [open, setOpen] = useState(false)

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
        // The ACTUAL terms — the per-quote override if any, else the Settings
        // text for the language — so the popup opens on what will be printed.
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
      // If the text still equals the Settings default, store no override (null) so
      // this quote keeps following the global text; only real edits are saved.
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
  const settingsText = effLang === 'ar' ? placeholder.ar : placeholder.en
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const edited = text.trim() !== settingsText.trim()

  const statusLine =
    status === 'saving' ? <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />{tx('يُحفظ…', 'Saving…')}</span>
    : status === 'saved' ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700"><Check className="w-3 h-3" />{tx('محفوظ', 'Saved')}</span>
    : status === 'dirty' ? <span className="text-[11px] text-amber-700">{tx('يُحفظ تلقائيًا…', 'Auto-saving…')}</span>
    : status === 'error' ? <span className="text-[11px] text-red-600">{tx('لم يُحفظ — أعد المحاولة', 'Not saved — retry')}</span>
    : null

  const yesNo = (v: boolean, label: string) => (
    <button type="button" onClick={() => update({ enabled: v })}
      className={`px-3 py-1 rounded-md ${enabled === v ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
      {label}
    </button>
  )

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-white" dir={uiAr ? 'rtl' : 'ltr'}>
      {/* The question, right where the owner asked for it: under the delivery choice. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <ScrollText className="w-4 h-4 text-indigo-600" />
          {tx('هل تريد الشروط والأحكام في العرض؟', 'Include Terms & Conditions on the quote?')}
        </span>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {yesNo(true, tx('نعم', 'Yes'))}
            {yesNo(false, tx('لا', 'No'))}
          </div>
          {statusLine}
        </div>
      </div>

      {enabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {edited
              ? tx(`شروط معدّلة لهذا العرض (${lines.length} نقطة)`, `Edited for this quote (${lines.length} bullets)`)
              : tx(`شروط الإعدادات كما هي (${lines.length} نقطة)`, `Settings terms as they are (${lines.length} bullets)`)}
          </span>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border p-0.5">
              {(['auto', 'ar', 'en'] as const).map((l) => (
                <button key={l} type="button" onClick={() => {
                  // Switching language re-pulls that language's Settings text UNLESS
                  // the owner already edited the box for this quote.
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
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5 h-7">
              <Pencil className="w-3.5 h-3.5" />{tx('عدّل', 'Edit')}
            </Button>
          </div>
        </div>
      )}

      {/* The popup: Settings terms pulled in, editable for THIS quote only. */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) void saveNow(); setOpen(o) }}>
        <DialogContent className="max-w-2xl" dir={uiAr ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>{tx('الشروط والأحكام — لهذا العرض', 'Terms & Conditions — this quote')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {tx('النص مسحوب من الإعدادات. أي تعديل هنا يخص هذا العرض فقط ولا يغيّر الإعدادات.', 'Pulled from Settings. Edits here apply to this quote only and never change Settings.')}
          </p>
          <textarea value={text} onChange={(e) => update({ text: e.target.value })} rows={9} dir={effLang === 'ar' ? 'rtl' : 'ltr'}
            placeholder={settingsText || tx('نقطة لكل سطر…', 'One bullet per line…')}
            className="w-full rounded-md border px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-400" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button" onClick={() => update({ text: settingsText })} className="text-[11px] text-indigo-600 hover:underline">
              {tx('استرجاع نص الإعدادات', 'Reset to Settings text')}
            </button>
            {statusLine}
          </div>
          <DialogFooter>
            <Button onClick={async () => { await saveNow(); setOpen(false) }} disabled={status === 'saving'} className="gap-1.5">
              {status === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {tx('حفظ وإغلاق', 'Save & close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
