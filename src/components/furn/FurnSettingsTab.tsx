'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Camera, Flame, Image as ImageIcon, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { FurnSettings, FurnDepartment } from '@/types'

export function FurnSettingsTab() {
  const { t, isRtl } = useLanguage()
  const [settings, setSettings] = useState<FurnSettings | null>(null)
  const [departments, setDepartments] = useState<FurnDepartment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingHeader, setUploadingHeader] = useState(false)
  const [uploadingSig, setUploadingSig] = useState(false)
  const [uploadingSeal, setUploadingSeal] = useState(false)
  const [newDeptEn, setNewDeptEn] = useState('')
  const [newDeptAr, setNewDeptAr] = useState('')
  const [addingDept, setAddingDept] = useState(false)

  const headerInputRef = useRef<HTMLInputElement>(null)
  const sigInputRef = useRef<HTMLInputElement>(null)
  const sealInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const [sRes, dRes] = await Promise.all([
        fetch('/api/furn/settings'),
        fetch('/api/furn/departments'),
      ])
      if (sRes.ok) {
        const j = await sRes.json()
        setSettings(j.settings)
      }
      if (dRes.ok) {
        const j = await dRes.json()
        setDepartments(j.departments)
      }
      setLoading(false)
    }
    load()
  }, [])

  function patch<K extends keyof FurnSettings>(key: K, value: FurnSettings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
  }

  async function uploadBranding(file: File, kind: 'header' | 'signature' | 'seal') {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'furn_branding')
    const setUploading =
      kind === 'header' ? setUploadingHeader
    : kind === 'signature' ? setUploadingSig
    : setUploadingSeal
    setUploading(true)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const j = await res.json()
    setUploading(false)
    if (!j.url) {
      toast.error(j.error || 'Upload failed')
      return
    }
    if (kind === 'header') patch('header_image_url', j.url)
    else if (kind === 'signature') patch('signature_image_url', j.url)
    else patch('seal_image_url', j.url)
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    const res = await fetch('/api/furn/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        header_image_url: settings.header_image_url,
        signature_image_url: settings.signature_image_url,
        seal_image_url: settings.seal_image_url,
        manager_name: settings.manager_name,
        company_phone: settings.company_phone,
        company_email: settings.company_email,
        commercial_register: settings.commercial_register,
        tax_number: settings.tax_number,
        footer_address: settings.footer_address,
        default_payment_terms: settings.default_payment_terms,
        default_delivery_terms: settings.default_delivery_terms,
        default_offer_duration: settings.default_offer_duration,
        default_special_conditions: settings.default_special_conditions,
        next_quotation_number: settings.next_quotation_number,
      }),
    })
    setSaving(false)
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Save failed')
      return
    }
    toast.success(t('furn_settings_saved'))
  }

  async function addDepartment() {
    if (!newDeptEn.trim() || !newDeptAr.trim()) {
      toast.error(t('furn_dept_name_en'))
      return
    }
    setAddingDept(true)
    const res = await fetch('/api/furn/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name_en: newDeptEn, name_ar: newDeptAr, enabled: true }),
    })
    setAddingDept(false)
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return
    }
    setDepartments(prev => [...prev, j.department])
    setNewDeptEn('')
    setNewDeptAr('')
  }

  async function toggleDept(d: FurnDepartment) {
    setDepartments(prev => prev.map(x => x.id === d.id ? { ...x, enabled: !x.enabled } : x))
    await fetch(`/api/furn/departments/${d.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !d.enabled }),
    })
  }

  async function deleteDept(d: FurnDepartment) {
    if (d.is_default) {
      toast.error('Default departments can\'t be deleted')
      return
    }
    if (!confirm(`Delete "${d.name_en}"?`)) return
    setDepartments(prev => prev.filter(x => x.id !== d.id))
    await fetch(`/api/furn/departments/${d.id}`, { method: 'DELETE' })
  }

  if (loading || !settings) {
    return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
  }

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-600" />
            {t('furn_settings_branding')}
          </CardTitle>
          <CardDescription>{t('furn_settings_title')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Header image */}
          <div className="space-y-2">
            <Label>{t('furn_settings_header_image')}</Label>
            <div className="flex items-center gap-4">
              <div className="w-40 h-20 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
                {settings.header_image_url ? (
                  <img src={settings.header_image_url} alt="" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => headerInputRef.current?.click()} disabled={uploadingHeader}>
                {uploadingHeader
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Camera className={`w-4 h-4 ${isRtl ? 'ml-1' : 'mr-1'}`} />Upload</>}
              </Button>
              <input ref={headerInputRef} type="file" accept="image/*" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadBranding(f, 'header'); e.target.value = '' }} />
            </div>
          </div>

          {/* Signature + Seal — sit side-by-side so the PDF preview
              mirrors how they'll be rendered together on the quotation. */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('furn_settings_signature')}</Label>
              <div className="flex items-center gap-3">
                <div className="w-32 h-20 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
                  {settings.signature_image_url ? (
                    <img src={settings.signature_image_url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => sigInputRef.current?.click()} disabled={uploadingSig}>
                  {uploadingSig
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><Camera className={`w-4 h-4 ${isRtl ? 'ml-1' : 'mr-1'}`} />Upload</>}
                </Button>
                <input ref={sigInputRef} type="file" accept="image/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadBranding(f, 'signature'); e.target.value = '' }} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('furn_settings_seal')}</Label>
              <div className="flex items-center gap-3">
                <div className="w-32 h-20 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
                  {settings.seal_image_url ? (
                    <img src={settings.seal_image_url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => sealInputRef.current?.click()} disabled={uploadingSeal}>
                  {uploadingSeal
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><Camera className={`w-4 h-4 ${isRtl ? 'ml-1' : 'mr-1'}`} />Upload</>}
                </Button>
                <input ref={sealInputRef} type="file" accept="image/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadBranding(f, 'seal'); e.target.value = '' }} />
              </div>
              <p className="text-[11px] text-muted-foreground">{t('furn_settings_seal_hint')}</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('furn_settings_manager_name')}</Label>
              <Input value={settings.manager_name || ''} onChange={e => patch('manager_name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_company_phone')}</Label>
              <Input value={settings.company_phone || ''} onChange={e => patch('company_phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_company_email')}</Label>
              <Input type="email" value={settings.company_email || ''} onChange={e => patch('company_email', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_commercial_register')}</Label>
              <Input value={settings.commercial_register || ''} onChange={e => patch('commercial_register', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_tax_number')}</Label>
              <Input value={settings.tax_number || ''} onChange={e => patch('tax_number', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_next_number')}</Label>
              <Input type="number" min={1} value={settings.next_quotation_number}
                onChange={e => patch('next_quotation_number', Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>{t('furn_settings_footer_address')}</Label>
              <Textarea rows={2} value={settings.footer_address || ''} onChange={e => patch('footer_address', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('furn_settings_defaults')}</CardTitle>
          <CardDescription>{t('furn_form_payment_terms_hint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('furn_settings_default_payment')}</Label>
              <Textarea rows={2} value={settings.default_payment_terms || ''} onChange={e => patch('default_payment_terms', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_default_delivery')}</Label>
              <Textarea rows={2} value={settings.default_delivery_terms || ''} onChange={e => patch('default_delivery_terms', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_default_offer')}</Label>
              <Input value={settings.default_offer_duration || ''} onChange={e => patch('default_offer_duration', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('furn_settings_default_special')}</Label>
              <Textarea rows={2} value={settings.default_special_conditions || ''} onChange={e => patch('default_special_conditions', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('furn_settings_departments')}</CardTitle>
          <CardDescription>{t('furn_settings_departments_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {departments.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-2 rounded border bg-muted/30">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={() => toggleDept(d)}
                    className="w-4 h-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{d.name_en}</p>
                    <p className="text-xs text-muted-foreground">{d.name_ar}</p>
                  </div>
                  {d.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">default</span>}
                </div>
                {!d.is_default && (
                  <Button variant="ghost" size="sm" onClick={() => deleteDept(d)} className="text-red-600 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t pt-3 grid md:grid-cols-3 gap-2">
            <Input placeholder={t('furn_dept_name_en')} value={newDeptEn} onChange={e => setNewDeptEn(e.target.value)} />
            <Input placeholder={t('furn_dept_name_ar')} value={newDeptAr} onChange={e => setNewDeptAr(e.target.value)} />
            <Button onClick={addDepartment} disabled={addingDept || !newDeptEn || !newDeptAr} variant="outline">
              {addingDept
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <><Plus className={`w-4 h-4 ${isRtl ? 'ml-1' : 'mr-1'}`} />{t('furn_dept_add')}</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} size="lg" className="bg-orange-600 hover:bg-orange-700 text-white">
        {saving
          ? <><Loader2 className={`w-4 h-4 animate-spin ${isRtl ? 'ml-2' : 'mr-2'}`} />Saving…</>
          : <><Save className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />{t('furn_settings_save')}</>}
      </Button>
    </div>
  )
}
