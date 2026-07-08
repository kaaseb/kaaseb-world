'use client'

// Super-admin panel: pick the AI engine that powers BOQ analysis (Furn /
// Tannoor) + the chat assistant, store the OpenAI AND Gemini keys (encrypted
// server-side, never read back), and choose the chat / document models from
// LIVE dropdowns fetched per provider. The "documents / BOQ model" is exactly
// the model that runs inside Furn and Tannoor.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Bot, CheckCircle2, KeyRound, Loader2, Save, Sparkles, FileSearch, MessageSquare } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AiProviderId, AiSettingsPublic } from '@/types'

interface ModelLists { openai: string[]; gemini: string[] }

function ModelSelect({ value, list, onChange }: { value: string; list: string[]; onChange: (v: string) => void }) {
  // Always include the current value so a saved model shows even before the
  // live list loads (or if it isn't in the list).
  const options = Array.from(new Set([value, ...list].filter(Boolean)))
  return (
    <select
      dir="ltr"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full h-9 bg-background border border-input rounded-md text-sm px-2"
    >
      {options.length === 0 && <option value="">—</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function AiSettingsTab() {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'

  const [settings, setSettings] = useState<AiSettingsPublic | null>(null)
  const [models, setModels] = useState<ModelLists>({ openai: [], gemini: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [sRes, mRes] = await Promise.all([
          fetch('/api/ai/settings'),
          fetch('/api/ai/models'),
        ])
        if (sRes.ok) { const j = await sRes.json(); setSettings(j.settings) }
        if (mRes.ok) { const j = await mRes.json(); setModels({ openai: j.openai || [], gemini: j.gemini || [] }) }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function patch<K extends keyof AiSettingsPublic>(key: K, value: AiSettingsPublic[K]) {
    setSettings(prev => (prev ? { ...prev, [key]: value } : prev))
  }

  async function save(extra?: Record<string, unknown>) {
    if (!settings) return
    setSaving(true)
    const body: Record<string, unknown> = {
      provider: settings.provider,
      openai_model: settings.openai_model,
      openai_boq_model: settings.openai_boq_model,
      gemini_model: settings.gemini_model,
      gemini_boq_model: settings.gemini_boq_model,
      ...extra,
    }
    // Only send a key when the admin typed a new one (unless the caller set it).
    if (!(extra && 'openai_api_key' in extra) && openaiKey.trim()) body.openai_api_key = openaiKey.trim()
    if (!(extra && 'gemini_api_key' in extra) && geminiKey.trim()) body.gemini_api_key = geminiKey.trim()

    const res = await fetch('/api/ai/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast.error(j.error || (ar ? 'فشل الحفظ' : 'Save failed')); return }
    setSettings(j.settings)
    setOpenaiKey('')
    setGeminiKey('')
    toast.success(ar ? 'تم حفظ إعدادات الذكاء الاصطناعي' : 'AI settings saved')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }
  if (!settings) return null

  const provider = settings.provider
  const boqLabel = ar ? 'موديل الفرن والتنور (تحليل BOQ)' : 'Furn & Tannoor model (BOQ)'
  const chatLabel = ar ? 'موديل المحادثة (مساعد كاسب)' : 'Chat model (assistant)'

  return (
    <Card dir={isRtl ? 'rtl' : 'ltr'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          {ar ? 'الذكاء الاصطناعي' : 'AI Engine'}
        </CardTitle>
        <CardDescription>
          {ar
            ? 'يتحكم في المحرك الذي يشغّل تحليل جداول الكميات (الفرن / التنور) ومساعد المحادثة. المزوّد المختار أدناه هو المستخدم فعلياً.'
            : 'Controls the engine that powers BOQ analysis (Furn / Tannoor) and the chat assistant. The selected provider below is what actually runs.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Provider switch */}
        <div className="space-y-2">
          <Label>{ar ? 'المزوّد النشط' : 'Active provider'}</Label>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            {([
              { id: 'openai' as const, label: 'OpenAI', icon: Sparkles, hint: ar ? 'دقة عالية' : 'High accuracy' },
              { id: 'gemini' as const, label: 'Google Gemini', icon: Bot, hint: ar ? 'أرخص وأسرع' : 'Cheaper & faster' },
            ]).map(opt => {
              const Icon = opt.icon
              const active = provider === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => patch('provider', opt.id as AiProviderId)}
                  className={[
                    'flex items-center gap-3 rounded-lg border px-4 py-3 text-start transition-colors',
                    active ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                  ].join(' ')}
                >
                  <Icon className={active ? 'w-5 h-5 text-primary' : 'w-5 h-5 text-muted-foreground'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.hint}</p>
                  </div>
                  {active && <CheckCircle2 className="w-4 h-4 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* OpenAI config */}
        {provider === 'openai' && (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><KeyRound className="w-4 h-4" />{ar ? 'مفتاح OpenAI API' : 'OpenAI API Key'}</Label>
              <Input type="password" autoComplete="off" dir="ltr"
                placeholder={settings.has_openai_key ? (ar ? '•••••••••••••••• (محفوظ)' : '•••••••••••••••• (saved)') : 'sk-...'}
                value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {settings.has_openai_key
                    ? (ar ? '✓ يوجد مفتاح محفوظ ومشفّر. اكتب مفتاحاً جديداً لاستبداله.' : '✓ A key is stored (encrypted). Type a new one to replace it.')
                    : (ar ? 'لم يُحفظ أي مفتاح بعد.' : 'No key stored yet.')}
                </p>
                {settings.has_openai_key && (
                  <button type="button" onClick={() => save({ openai_api_key: '' })} disabled={saving} className="text-xs text-red-500 hover:text-red-600 shrink-0">
                    {ar ? 'حذف المفتاح' : 'Remove key'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" />{chatLabel}</Label>
                <ModelSelect value={settings.openai_model} list={models.openai} onChange={v => patch('openai_model', v)} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><FileSearch className="w-3.5 h-3.5 text-primary" />{boqLabel}</Label>
                <ModelSelect value={settings.openai_boq_model} list={models.openai} onChange={v => patch('openai_boq_model', v)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {ar
                ? 'موديل الفرن/التنور لازم يدعم الرؤية (صور/PDF) والمخرجات المنظّمة — الموصى به gpt-5.4 أو gpt-5.5 لأعلى دقة. القائمة محدّثة مباشرة من حسابك.'
                : 'The Furn/Tannoor model must support vision (images/PDF) + structured output — gpt-5.4, or gpt-5.5 for top accuracy. The list is live from your account.'}
            </p>
          </div>
        )}

        {/* Gemini config */}
        {provider === 'gemini' && (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><KeyRound className="w-4 h-4" />{ar ? 'مفتاح Gemini API (المدفوع)' : 'Gemini API Key (paid)'}</Label>
              <Input type="password" autoComplete="off" dir="ltr"
                placeholder={settings.has_gemini_key ? (ar ? '•••••••••••••••• (محفوظ)' : '•••••••••••••••• (saved)') : 'AIza...'}
                value={geminiKey} onChange={e => setGeminiKey(e.target.value)} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {settings.has_gemini_key
                    ? (ar ? '✓ يوجد مفتاح محفوظ ومشفّر. اكتب مفتاحاً جديداً لاستبداله.' : '✓ A key is stored (encrypted). Type a new one to replace it.')
                    : (ar ? 'الصق مفتاح Gemini هنا (أو يُقرأ من متغيّر البيئة).' : 'Paste your Gemini key here (or it falls back to the env variable).')}
                </p>
                {settings.has_gemini_key && (
                  <button type="button" onClick={() => save({ gemini_api_key: '' })} disabled={saving} className="text-xs text-red-500 hover:text-red-600 shrink-0">
                    {ar ? 'حذف المفتاح' : 'Remove key'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" />{chatLabel}</Label>
                <ModelSelect value={settings.gemini_model} list={models.gemini} onChange={v => patch('gemini_model', v)} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><FileSearch className="w-3.5 h-3.5 text-primary" />{boqLabel}</Label>
                <ModelSelect value={settings.gemini_boq_model} list={models.gemini} onChange={v => patch('gemini_boq_model', v)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {ar
                ? 'موديل الفرن/التنور لازم يدعم الرؤية والمخرجات المنظّمة — الموصى به gemini-2.5-pro أو gemini-3-pro لأعلى دقة. القائمة محدّثة مباشرة من حسابك.'
                : 'The Furn/Tannoor model must support vision + structured output — gemini-2.5-pro, or gemini-3-pro for top accuracy. The list is live from your account.'}
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => save()} disabled={saving}>
            {saving
              ? <><Loader2 className="w-4 h-4 me-2 animate-spin" />{ar ? 'جارٍ الحفظ' : 'Saving'}</>
              : <><Save className="w-4 h-4 me-2" />{ar ? 'حفظ' : 'Save'}</>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
