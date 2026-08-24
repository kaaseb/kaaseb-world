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
        setEnabled(ov?.enabled ?? !!global.defaultEnabled)
        setLang(ov?.lang === 'ar' || ov?.lang === 'en' ? ov.lang : 'auto')
        setText((ov?.terms || []).join('\n'))
      } catch { /* ignore */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [scopeKey])

  async function save() {
    setSaving(true)
    try {
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
      const res = await fetch('/api/quote-terms/override', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: scopeKey, enabled, lang: lang === 'auto' ? null : lang, terms: lines.length ? lines : null }),
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
              <button key={l} type="button" onClick={() => setLang(l)} className={`px-2 py-0.5 rounded ${lang === l ? 'bg-indigo-600 text-white' : 'text-muted-foreground'}`}>
                {l === 'auto' ? tx('تلقائي', 'Auto') : l === 'ar' ? 'عربي' : 'EN'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} dir={effLang === 'ar' ? 'rtl' : 'ltr'}
        placeholder={ph}
        className="w-full rounded-md border px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-400" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{tx('فارغ = الشروط الافتراضية من الإعدادات.', 'Empty = default terms from settings.')}</p>
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}{tx('حفظ', 'Save')}
        </Button>
      </div>
    </div>
  )
}
