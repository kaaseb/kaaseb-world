'use client'

// Per-quote Terms & Conditions control, reused by the Furn / Tannoor / manual
// screens. Lets one quote: include the T&C or not, pick its language (auto =
// follow the PDF's language), and override the bullet lines. Saved to the S3
// override store keyed `<scope>:<id>`.

import { useEffect, useState } from 'react'
import { Loader2, ScrollText, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type LangSel = 'auto' | 'ar' | 'en'

export function QuoteTermsControl({ scopeKey, uiAr, quoteLang }: { scopeKey: string; uiAr: boolean; quoteLang: 'ar' | 'en' }) {
  const tx = (a: string, e: string) => (uiAr ? a : e)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [lang, setLang] = useState<LangSel>('auto')
  const [text, setText] = useState('')
  const [placeholder, setPlaceholder] = useState<{ ar: string; en: string }>({ ar: '', en: '' })

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
        setPlaceholder({ ar: (global.ar || []).join('\n'), en: (global.en || []).join('\n') })
        const ov = o.override
        const lang0: LangSel = ov?.lang === 'ar' || ov?.lang === 'en' ? ov.lang : 'auto'
        const effLang0 = lang0 === 'auto' ? quoteLang : lang0
        setEnabled(ov?.enabled ?? !!global.defaultEnabled)
        setLang(lang0)
        // Pre-fill the box with the ACTUAL terms — the per-quote override if any,
        // else the settings default for the language — so it's visible + editable.
        setText((ov?.terms && ov.terms.length ? ov.terms : (effLang0 === 'ar' ? global.ar : global.en)).join('\n'))
      } catch { /* ignore */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [scopeKey])

  async function save() {
    setSaving(true)
    try {
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
      // If the text still equals the settings default, store no override (null) so
      // this quote keeps following the global default; only real edits are saved.
      const effLang = lang === 'auto' ? quoteLang : lang
      const defLines = (effLang === 'ar' ? placeholder.ar : placeholder.en).split('\n').map((s) => s.trim()).filter(Boolean)
      const same = lines.length === defLines.length && lines.every((l, i) => l === defLines[i])
      const termsToSave = lines.length && !same ? lines : null
      const res = await fetch('/api/quote-terms/override', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: scopeKey, enabled, lang: lang === 'auto' ? null : lang, terms: termsToSave }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'فشل الحفظ'); return }
      toast.success(tx('تم حفظ الشروط ✓', 'Terms saved ✓'))
    } catch { toast.error('فشل الحفظ') } finally { setSaving(false) }
  }

  if (loading) return null

  const effLang = lang === 'auto' ? quoteLang : lang
  const ph = (effLang === 'ar' ? placeholder.ar : placeholder.en) || tx('نقطة لكل سطر…', 'One bullet per line…')

  return (
    <div className="rounded-lg border p-3 space-y-2 bg-white" dir={uiAr ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold flex items-center gap-1.5"><ScrollText className="w-4 h-4 text-indigo-600" />{tx('الشروط والأحكام', 'Terms & Conditions')}</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-indigo-600" />{tx('أدرج في العرض', 'Include')}</label>
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            {(['auto', 'ar', 'en'] as const).map((l) => (
              <button key={l} type="button" onClick={() => {
                // Switching language re-pulls that language's default text UNLESS the
                // user already edited the box (text differs from the old default).
                const oldEff = lang === 'auto' ? quoteLang : lang
                const oldDefault = (oldEff === 'ar' ? placeholder.ar : placeholder.en).trim()
                if (text.trim() === oldDefault) {
                  const newEff = l === 'auto' ? quoteLang : l
                  setText(newEff === 'ar' ? placeholder.ar : placeholder.en)
                }
                setLang(l)
              }} className={`px-2 py-0.5 rounded ${lang === l ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>
                {l === 'auto' ? tx('تلقائي', 'Auto') : l === 'ar' ? 'عربي' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} dir={effLang === 'ar' ? 'rtl' : 'ltr'}
        placeholder={ph}
        className="w-full rounded-md border px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-400" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => setText(effLang === 'ar' ? placeholder.ar : placeholder.en)}
          className="text-[11px] text-indigo-600 hover:underline">
          {tx('استرجاع النص من الإعدادات', 'Reset text from settings')}
        </button>
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{tx('حفظ', 'Save')}
        </Button>
      </div>
    </div>
  )
}
