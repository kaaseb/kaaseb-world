'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Camera, X, Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'

const COLORS = [
  { key: 'indigo',  css: 'linear-gradient(180deg, #a5b4fc 0%, #818cf8 50%, #eef2ff 100%)' },
  { key: 'violet',  css: 'linear-gradient(180deg, #c4b5fd 0%, #8b5cf6 50%, #f5f3ff 100%)' },
  { key: 'olive',   css: 'linear-gradient(180deg, #d9f99d 0%, #a3a635 50%, #f7fee7 100%)' },
  { key: 'amber',   css: 'linear-gradient(180deg, #fde68a 0%, #f59e0b 50%, #fffbeb 100%)' },
  { key: 'rose',    css: 'linear-gradient(180deg, #fecdd3 0%, #f43f5e 50%, #fff1f2 100%)' },
  { key: 'emerald', css: 'linear-gradient(180deg, #a7f3d0 0%, #10b981 50%, #ecfdf5 100%)' },
  { key: 'sky',     css: 'linear-gradient(180deg, #bae6fd 0%, #0ea5e9 50%, #f0f9ff 100%)' },
]

export interface EditableGoal {
  id: string
  title: string
  subtitle?: string | null
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  reward_points?: number | null
  image_url?: string | null
  color?: string | null
  department_id?: string | null
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  goal: EditableGoal
  departments?: { id: string; name: string }[]
  onSaved: (updated: EditableGoal) => void
}

export function EditGoalDialog({ open, onOpenChange, goal, departments = [], onSaved }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [title, setTitle] = useState(goal.title)
  const [subtitle, setSubtitle] = useState(goal.subtitle || '')
  const [description, setDescription] = useState(goal.description || '')
  const [startDate, setStartDate] = useState(goal.start_date || '')
  const [endDate, setEndDate] = useState(goal.end_date || '')
  const [rewardPoints, setRewardPoints] = useState(String(goal.reward_points ?? 0))
  const [imageUrl, setImageUrl] = useState<string | null>(goal.image_url ?? null)
  const [colorKey, setColorKey] = useState<string>(goal.color || COLORS[0].key)
  const [deptId, setDeptId] = useState<string>(goal.department_id || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset form whenever a new goal is opened
  useEffect(() => {
    if (!open) return
    setTitle(goal.title)
    setSubtitle(goal.subtitle || '')
    setDescription(goal.description || '')
    setStartDate(goal.start_date || '')
    setEndDate(goal.end_date || '')
    setRewardPoints(String(goal.reward_points ?? 0))
    setImageUrl(goal.image_url ?? null)
    setColorKey(goal.color || COLORS[0].key)
    setDeptId(goal.department_id || '')
  }, [open, goal])

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'goals')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) setImageUrl(result.url)
    else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const patch = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      start_date: startDate || null,
      end_date: endDate || null,
      reward_points: Number(rewardPoints) || 0,
      image_url: imageUrl,
      color: colorKey,
      department_id: deptId || null,
      is_global: !deptId,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase
      .from('goals').update(patch).eq('id', goal.id).select('*').single()
    if (error) toast.error(error.message)
    else {
      toast.success(t('saved'))
      onSaved(data as EditableGoal)
      onOpenChange(false)
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />{t('goal_edit')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <div className="space-y-1.5">
            <Label>{t('goal_image')}</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadImage(f)
                e.target.value = ''
              }}
            />
            {imageUrl ? (
              <div className="relative inline-block">
                <img src={imageUrl} alt="" className="h-28 w-full max-w-[18rem] object-cover rounded-lg border border-gray-200" />
                <button type="button" onClick={() => setImageUrl(null)} className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-600 hover:text-red-600">
                  <X className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="absolute bottom-1 end-1 px-2 py-1 rounded-md bg-black/60 text-white text-xs flex items-center gap-1">
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                  {t('washhouse_image_change')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="h-28 w-full max-w-[18rem] rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-600 hover:border-gray-300">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                <span className="text-xs">{t('goal_image_add')}</span>
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('goal_name')} *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>{t('goal_subtitle')}</Label>
            <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('description')}</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('goal_start')}</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('goal_end')}</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('goal_reward')}</Label>
              <Input type="number" min="0" value={rewardPoints} onChange={e => setRewardPoints(e.target.value)} />
            </div>
            {departments.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t('goal_department_pick')}</Label>
                <select value={deptId} onChange={e => setDeptId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">🌐 {t('idea_general')}</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{t('goal_color')}</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColorKey(c.key)}
                  className={`w-9 h-9 rounded-full transition-all ring-2 ${colorKey === c.key ? 'ring-gray-900 ring-offset-2' : 'ring-transparent'}`}
                  style={{ background: c.css }}
                  aria-label={c.key}
                />
              ))}
            </div>
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
