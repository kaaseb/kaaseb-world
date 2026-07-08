'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Plus, Target, Rocket, Trophy, Flame, Star, Trash2, ChevronRight, Award, Loader2, Calendar, Camera, X, Pencil, PauseCircle } from 'lucide-react'
import { EditGoalDialog } from './EditGoalDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'

type GoalStep = { id: string; goal_id: string; title: string; completed: boolean; position: number }
type GoalRow = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  department_id: string | null
  is_global: boolean
  owner_id: string | null
  start_date: string | null
  end_date: string | null
  reward_points: number | null
  color: string | null
  image_url: string | null
  completed: boolean
  paused?: boolean
  pause_reason?: string | null
  created_at: string
  goal_steps: GoalStep[]
  departments?: { name: string } | null
}

const COLORS = [
  { key: 'indigo',  css: 'linear-gradient(180deg, #a5b4fc 0%, #818cf8 50%, #eef2ff 100%)', icon: Rocket,   iconColor: 'text-indigo-500' },
  { key: 'violet',  css: 'linear-gradient(180deg, #c4b5fd 0%, #8b5cf6 50%, #f5f3ff 100%)', icon: Target,   iconColor: 'text-violet-500' },
  { key: 'olive',   css: 'linear-gradient(180deg, #d9f99d 0%, #a3a635 50%, #f7fee7 100%)', icon: Target,   iconColor: 'text-lime-700' },
  { key: 'amber',   css: 'linear-gradient(180deg, #fde68a 0%, #f59e0b 50%, #fffbeb 100%)', icon: Flame,    iconColor: 'text-amber-600' },
  { key: 'rose',    css: 'linear-gradient(180deg, #fecdd3 0%, #f43f5e 50%, #fff1f2 100%)', icon: Trophy,   iconColor: 'text-rose-600' },
  { key: 'emerald', css: 'linear-gradient(180deg, #a7f3d0 0%, #10b981 50%, #ecfdf5 100%)', icon: Star,     iconColor: 'text-emerald-600' },
  { key: 'sky',     css: 'linear-gradient(180deg, #bae6fd 0%, #0ea5e9 50%, #f0f9ff 100%)', icon: Rocket,   iconColor: 'text-sky-600' },
]

function colorFor(key: string | null) {
  return COLORS.find(c => c.key === key) ?? COLORS[0]
}

interface Props {
  profile: Profile
  initGoals: GoalRow[]
  departments: { id: string; name: string }[]
  allProfiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
}

export function GoalsRoadmapClient({ profile, initGoals, departments }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const supabase = createClient()
  const [goals, setGoals] = useState(initGoals)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<GoalRow | null>(null)
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [description, setDescription] = useState('')
  const [rewardPoints, setRewardPoints] = useState('100')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [deptId, setDeptId] = useState<string>('')
  const [colorKey, setColorKey] = useState(COLORS[0].key)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)

  const isSuperAdmin = profile.role === 'super_admin'

  function resetForm() {
    setName(''); setSubtitle(''); setDescription(''); setRewardPoints('100')
    setStartDate(''); setEndDate(''); setDeptId(''); setColorKey(COLORS[0].key)
    setImageUrl(null)
  }

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'goals')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) setImageUrl(result.url)
    else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  async function createGoal(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase
      .from('goals')
      .insert({
        title: name.trim(),
        subtitle: subtitle.trim() || null,
        description: description.trim() || null,
        department_id: deptId || null,
        is_global: !deptId,
        owner_id: profile.id,
        created_by: profile.id,
        start_date: startDate || null,
        end_date: endDate || null,
        reward_points: Number(rewardPoints) || 0,
        color: colorKey,
        image_url: imageUrl,
      })
      .select('*, goal_steps(*), departments(name)')
      .single()
    if (error) toast.error(error.message)
    else {
      setGoals([data as GoalRow, ...goals])
      resetForm()
      setCreateOpen(false)
      toast.success(t('goal_created'))
    }
    setSaving(false)
  }

  async function deleteGoal(id: string) {
    if (!confirm(t('confirm_delete'))) return
    const { error } = await supabase.from('goals').delete().eq('id', id)
    if (error) toast.error(error.message)
    else {
      setGoals(goals.filter(g => g.id !== id))
      toast.success(t('deleted'))
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="w-6 h-6 text-indigo-500" />
            {t('goals_title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('goals_subtitle')}</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />{t('goal_new')}
          </button>
        )}
      </div>

      {/* Edit dialog (for the card being edited) */}
      {editTarget && (
        <EditGoalDialog
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          goal={editTarget}
          departments={departments}
          onSaved={(u) => {
            setGoals(goals.map(g => g.id === u.id ? { ...g, ...u } as GoalRow : g))
            setEditTarget(null)
          }}
        />
      )}

      {goals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
          <Target className="w-12 h-12 mx-auto mb-3 text-gray-200" />
          <h3 className="text-base font-semibold text-gray-900">{t('goals_empty_title')}</h3>
          <p className="text-sm text-gray-400 mt-1">{t('goals_empty_hint')}</p>
          {isSuperAdmin && (
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-semibold text-sm"
            >
              <Plus className="w-4 h-4" />{t('goal_new')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {goals.map(g => {
            const canManage = isSuperAdmin || g.owner_id === profile.id
            return (
              <GoalCard
                key={g.id}
                goal={g}
                onOpen={() => router.push(`/goals/${g.id}`)}
                onEdit={() => setEditTarget(g)}
                onDelete={() => deleteGoal(g.id)}
                canManage={canManage}
              />
            )
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('goal_new')}</DialogTitle></DialogHeader>
          <form onSubmit={createGoal} className="space-y-3 mt-2">
            {/* Image uploader */}
            <div className="space-y-1.5">
              <Label>{t('goal_image')}</Label>
              <input
                ref={fileInputRef}
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
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="absolute -top-2 -end-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-600 hover:text-red-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="absolute bottom-1 end-1 px-2 py-1 rounded-md bg-black/60 text-white text-xs flex items-center gap-1 hover:bg-black/80"
                  >
                    {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                    {t('washhouse_image_change')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-28 w-full max-w-[18rem] rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
                >
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                  <span className="text-xs">{t('goal_image_add')}</span>
                </button>
              )}
              <p className="text-xs text-gray-400">{t('goal_image_hint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label>{t('goal_name')} *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('goal_name_ph')} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t('goal_subtitle')}</Label>
              <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder={t('goal_subtitle_ph')} />
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
              <div className="space-y-1.5">
                <Label>{t('goal_department_pick')}</Label>
                <select value={deptId} onChange={e => setDeptId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">🌐 {t('idea_general')}</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('goal_color')}</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setColorKey(c.key)}
                    className={`w-10 h-10 rounded-full transition-all ring-2 ${colorKey === c.key ? 'ring-gray-900 ring-offset-2' : 'ring-transparent'}`}
                    style={{ background: c.css }}
                    aria-label={c.key}
                  />
                ))}
              </div>
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GoalCard({ goal, onOpen, onEdit, onDelete, canManage }: {
  goal: GoalRow
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  canManage: boolean
}) {
  const { t, isRtl } = useLanguage()
  const c = colorFor(goal.color)
  const Icon = c.icon
  const total = goal.goal_steps.length
  const done = goal.goal_steps.filter(s => s.completed).length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  const isPaused = !!goal.paused

  return (
    <article
      className={`relative rounded-2xl bg-white border overflow-hidden cursor-pointer transition-all group ${
        isPaused
          ? 'border-amber-200 dark:border-amber-400/30 hover:shadow-md saturate-[0.55]'
          : 'border-gray-100 hover:shadow-lg'
      }`}
      onClick={onOpen}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Diagonal "Paused" ribbon — corner banner so the state reads even
          without scrolling text. Suppressed when the goal isn't paused. */}
      {isPaused && (
        <div className={`absolute top-3 ${isRtl ? 'left-3' : 'right-3'} z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/95 text-white text-[10.5px] font-bold shadow-md`}>
          <PauseCircle className="w-3 h-3" />
          {t('goal_paused_label')}
        </div>
      )}
      {/* Header: image if present, otherwise gradient + icon */}
      <div className={`relative h-52 flex items-center justify-center overflow-hidden ${isPaused ? 'opacity-70' : ''}`} style={{ background: goal.image_url ? undefined : c.css }}>
        {goal.image_url ? (
          <img src={goal.image_url} alt={goal.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <Icon className={`w-24 h-24 ${c.iconColor} opacity-30`} strokeWidth={1.5} />
        )}
        {/* Gradient overlay for readability when image is present */}
        {goal.image_url && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-black/30" />
        )}
        {/* Extra darken for paused goals so the title pill still pops above
            the now-muted artwork. */}
        {isPaused && <div className="absolute inset-0 bg-black/20" />}
        {/* Title pill at top */}
        <span className={`absolute top-4 start-4 inline-flex items-center gap-1 px-3 py-1 rounded-full text-white text-xs font-semibold shadow max-w-[80%] truncate ${
          isPaused ? 'bg-gray-500' : 'bg-blue-500'
        }`}>
          {goal.title}
        </span>
        {canManage && (
          <div className="absolute top-3 end-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit() }}
              className="p-1.5 rounded-md bg-white/95 hover:bg-white text-gray-700 shadow"
              aria-label="edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-1.5 rounded-md bg-red-500/90 hover:bg-red-500 text-white"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        <h3 className="text-base font-bold text-gray-900 line-clamp-2">{goal.title}</h3>
        {goal.subtitle && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{goal.subtitle}</p>}

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{t('goal_progress_label')}</span>
            <span className="font-bold text-blue-600">{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
            <Award className="w-3.5 h-3.5" />
            +{goal.reward_points || 0} {t('points_unit')}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onOpen() }} className="inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-700">
            {t('goal_open_roadmap')}
            <ChevronRight className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {(goal.start_date || goal.end_date) && (
          <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {goal.start_date} {goal.end_date && `— ${goal.end_date}`}
          </p>
        )}
      </div>
    </article>
  )
}
