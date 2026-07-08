'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ArrowRight, ArrowLeft, Plus, Calendar, Edit, Trash2, Check, Loader2, Target, Award, Flag, X, ListChecks, Pencil,
  PauseCircle, PlayCircle,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile, GoalStepTask } from '@/types'
import { EditGoalDialog } from './EditGoalDialog'

type GoalStep = {
  id: string
  goal_id: string
  title: string
  completed: boolean
  position: number
  goal_step_tasks?: GoalStepTask[]
}
type GoalDetail = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  color: string | null
  image_url: string | null
  owner_id: string | null
  owner: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  departments: { id: string; name: string } | null
  start_date: string | null
  end_date: string | null
  reward_points: number | null
  completed: boolean
  paused: boolean
  pause_reason: string | null
  paused_by: string | null
  paused_at: string | null
  goal_steps: GoalStep[]
}

interface Props {
  profile: Profile
  goal: GoalDetail
  allMembers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
}

export function GoalRoadmapDetail({ profile, goal: initGoal, allMembers }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const supabase = createClient()
  const [goal, setGoal] = useState(initGoal)
  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false)
  const [milestoneTitle, setMilestoneTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingStep, setEditingStep] = useState<GoalStep | null>(null)
  const [editStepTitle, setEditStepTitle] = useState('')
  const [editGoalOpen, setEditGoalOpen] = useState(false)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [pausing, setPausing] = useState(false)

  const isOwner = profile.id === goal.owner_id
  const isSuperAdmin = profile.role === 'super_admin'
  const canEdit = isOwner || isSuperAdmin
  const pausedByMember = goal.paused_by ? allMembers.find(m => m.id === goal.paused_by) : null

  async function handlePause(e: React.FormEvent) {
    e.preventDefault()
    const reason = pauseReason.trim()
    if (!reason) { toast.error(t('goal_pause_reason_required')); return }
    setPausing(true)
    const { data, error } = await supabase
      .from('goals')
      .update({
        paused: true,
        pause_reason: reason,
        paused_by: profile.id,
        paused_at: new Date().toISOString(),
      })
      .eq('id', goal.id)
      .select('paused, pause_reason, paused_by, paused_at')
      .single()
    setPausing(false)
    if (error) { toast.error(error.message); return }
    setGoal({ ...goal, ...data })
    setPauseOpen(false)
    setPauseReason('')
    toast.success(t('goal_paused_toast'))
  }

  async function handleResume() {
    if (!confirm(t('goal_resume_confirm'))) return
    const { data, error } = await supabase
      .from('goals')
      .update({ paused: false, pause_reason: null, paused_by: null, paused_at: null })
      .eq('id', goal.id)
      .select('paused, pause_reason, paused_by, paused_at')
      .single()
    if (error) { toast.error(error.message); return }
    setGoal({ ...goal, ...data })
    toast.success(t('goal_resumed_toast'))
  }

  // Sort milestones by position
  const steps = useMemo(
    () => [...goal.goal_steps].sort((a, b) => a.position - b.position),
    [goal.goal_steps],
  )

  // Derived completion: a step is "effectively done" if
  //   - it has tasks AND all tasks are completed, OR
  //   - it has no tasks AND its manual `completed` flag is true.
  function stepIsDone(s: GoalStep): boolean {
    const tasks = s.goal_step_tasks ?? []
    if (tasks.length === 0) return s.completed
    return tasks.every(t => t.completed)
  }

  const total = steps.length
  const done = steps.filter(stepIsDone).length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const currentIdx = steps.findIndex(s => !stepIsDone(s))
  const currentPos = currentIdx === -1 ? total : currentIdx

  // ---- Milestone CRUD ----
  async function addMilestone(e: React.FormEvent) {
    e.preventDefault()
    if (!milestoneTitle.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('goal_steps')
      .insert({ goal_id: goal.id, title: milestoneTitle.trim(), position: total })
      .select('*')
      .single()
    if (error) toast.error(error.message)
    else {
      setGoal({ ...goal, goal_steps: [...goal.goal_steps, { ...(data as GoalStep), goal_step_tasks: [] }] })
      setMilestoneTitle('')
      setAddMilestoneOpen(false)
      toast.success(t('saved'))
    }
    setSaving(false)
  }

  async function saveEditStep(e: React.FormEvent) {
    e.preventDefault()
    if (!editingStep) return
    setSaving(true)
    const { data, error } = await supabase
      .from('goal_steps')
      .update({ title: editStepTitle.trim() })
      .eq('id', editingStep.id)
      .select('*')
      .single()
    if (error) toast.error(error.message)
    else {
      setGoal({
        ...goal,
        goal_steps: goal.goal_steps.map(s =>
          s.id === editingStep.id ? { ...s, ...data } : s,
        ),
      })
      setEditingStep(null)
      toast.success(t('saved'))
    }
    setSaving(false)
  }

  async function removeStep(id: string) {
    if (!confirm(t('confirm_delete'))) return
    const { error } = await supabase.from('goal_steps').delete().eq('id', id)
    if (error) toast.error(error.message)
    else {
      setGoal({ ...goal, goal_steps: goal.goal_steps.filter(s => s.id !== id) })
      toast.success(t('deleted'))
    }
  }

  async function toggleStepManually(step: GoalStep) {
    // Only used when the milestone has no tasks.
    if ((step.goal_step_tasks ?? []).length > 0) return
    const next = !step.completed
    const { data, error } = await supabase
      .from('goal_steps').update({ completed: next }).eq('id', step.id).select('*').single()
    if (error) toast.error(error.message)
    else {
      setGoal({
        ...goal,
        goal_steps: goal.goal_steps.map(s => s.id === step.id ? { ...s, ...data } : s),
      })
      if (next) toast.success(`🎉 ${step.title}`)
    }
  }

  // Per-task reward share: goal.reward_points split across every task in the goal.
  const totalTasksInGoal = useMemo(
    () => goal.goal_steps.reduce((sum, s) => sum + (s.goal_step_tasks?.length ?? 0), 0),
    [goal.goal_steps],
  )
  const rewardPoints = goal.reward_points ?? 0
  const pointsPerTask = totalTasksInGoal > 0 ? Math.floor(rewardPoints / totalTasksInGoal) : 0

  // Award (or reverse) a task's point share to the current user.
  async function awardPointsForTask(delta: number, taskId: string, taskTitle: string) {
    if (delta === 0) return
    // 1) Log in the pending_points ledger as approved.
    await supabase.from('pending_points').insert({
      user_id: profile.id,
      user_name: profile.full_name,
      user_email: profile.email,
      action_type: delta > 0 ? 'goal_task_done' : 'goal_task_undone',
      object_type: 'goal_task',
      object_name: `${goal.title} → ${taskTitle}`,
      object_id: taskId,
      points: delta,
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    // 2) Update total_points from the freshest value.
    const { data: fresh } = await supabase.from('profiles').select('total_points').eq('id', profile.id).single()
    const current = fresh?.total_points ?? 0
    const newPoints = Math.max(0, current + delta)
    await supabase.from('profiles').update({ total_points: newPoints }).eq('id', profile.id)
    if (delta > 0) toast.success(`+${delta} ${t('points_unit')} ⭐`)
  }

  // ---- Task CRUD ----
  async function addTask(stepId: string, title: string) {
    if (!title.trim()) return
    const step = goal.goal_steps.find(s => s.id === stepId)
    const position = (step?.goal_step_tasks ?? []).length
    const { data, error } = await supabase
      .from('goal_step_tasks')
      .insert({ step_id: stepId, title: title.trim(), position })
      .select('*')
      .single()
    if (error) { toast.error(error.message); return }
    setGoal({
      ...goal,
      goal_steps: goal.goal_steps.map(s =>
        s.id === stepId
          ? { ...s, goal_step_tasks: [...(s.goal_step_tasks ?? []), data as GoalStepTask] }
          : s,
      ),
    })
  }

  async function toggleTask(stepId: string, task: GoalStepTask) {
    const next = !task.completed
    // "Everyone" tasks are unrewarded. Otherwise, only the assigned user
    // (or anyone if no assignee yet — legacy) earns the share.
    const earns = !task.assigned_to_everyone &&
      (!task.assigned_user_id || task.assigned_user_id === profile.id)
    const { data, error } = await supabase
      .from('goal_step_tasks').update({ completed: next }).eq('id', task.id).select('*').single()
    if (error) { toast.error(error.message); return }

    if (earns) {
      awardPointsForTask(next ? pointsPerTask : -pointsPerTask, task.id, task.title)
    }

    // Apply optimistic update + check if the parent milestone just flipped
    setGoal(prev => {
      const updated = prev.goal_steps.map(s => {
        if (s.id !== stepId) return s
        const tasks = (s.goal_step_tasks ?? []).map(t => t.id === task.id ? (data as GoalStepTask) : t)
        return { ...s, goal_step_tasks: tasks }
      })

      // Sync the step.completed flag in the DB when it flips
      const touched = updated.find(s => s.id === stepId)
      const wasDone = (prev.goal_steps.find(s => s.id === stepId)?.goal_step_tasks ?? []).length > 0
        && (prev.goal_steps.find(s => s.id === stepId)?.goal_step_tasks ?? []).every(t => t.completed)
      const nowDone = (touched?.goal_step_tasks ?? []).length > 0
        && (touched?.goal_step_tasks ?? []).every(t => t.completed)
      if (wasDone !== nowDone) {
        supabase.from('goal_steps').update({ completed: nowDone }).eq('id', stepId).then(() => {})
        if (nowDone && touched) toast.success(`🎉 ${touched.title}`)
      }
      return { ...prev, goal_steps: updated }
    })
  }

  async function assignTask(stepId: string, taskId: string, mode: 'unassigned' | 'everyone' | { userId: string }) {
    const patch = mode === 'unassigned'
      ? { assigned_user_id: null, assigned_to_everyone: false }
      : mode === 'everyone'
        ? { assigned_user_id: null, assigned_to_everyone: true }
        : { assigned_user_id: mode.userId, assigned_to_everyone: false }
    const { data, error } = await supabase
      .from('goal_step_tasks').update(patch).eq('id', taskId).select('*').single()
    if (error) { toast.error(error.message); return }
    setGoal({
      ...goal,
      goal_steps: goal.goal_steps.map(s => s.id === stepId
        ? { ...s, goal_step_tasks: (s.goal_step_tasks ?? []).map(tt => tt.id === taskId ? (data as GoalStepTask) : tt) }
        : s),
    })
    // Notify the assignee by email (only on individual assignments, not
    // 'everyone' or 'unassigned'). Fire-and-forget.
    if (typeof mode === 'object' && 'userId' in mode) {
      fetch('/api/email/task-assigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'goal', taskId, assigneeId: mode.userId }),
      }).catch(() => {})
    }
  }

  async function removeTask(stepId: string, taskId: string) {
    const { error } = await supabase.from('goal_step_tasks').delete().eq('id', taskId)
    if (error) { toast.error(error.message); return }
    setGoal({
      ...goal,
      goal_steps: goal.goal_steps.map(s => s.id === stepId
        ? { ...s, goal_step_tasks: (s.goal_step_tasks ?? []).filter(t => t.id !== taskId) }
        : s),
    })
  }

  // ---- Goal CRUD ----
  function onGoalSaved(updated: Partial<GoalDetail>) {
    setGoal({ ...goal, ...updated })
    setEditGoalOpen(false)
  }

  const ArrowIcon = isRtl ? ArrowRight : ArrowLeft

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Pause banner — sits above everything so it can't be missed. */}
      {goal.paused && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-400/25 p-4 flex items-start gap-3">
          <PauseCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t('goal_paused_label')}</p>
            {goal.pause_reason && (
              <p className="text-sm text-amber-700 dark:text-amber-200/90 mt-1 whitespace-pre-wrap">{goal.pause_reason}</p>
            )}
            {(pausedByMember || goal.paused_at) && (
              <p className="text-xs text-amber-600/80 dark:text-amber-300/70 mt-2">
                {pausedByMember && <>{t('goal_paused_by')} <strong>{pausedByMember.full_name || pausedByMember.email?.split('@')[0]}</strong></>}
                {pausedByMember && goal.paused_at && ' · '}
                {goal.paused_at && (
                  <span suppressHydrationWarning>
                    {t('goal_paused_at')} {new Date(goal.paused_at).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
              </p>
            )}
          </div>
          {canEdit && (
            <button
              onClick={handleResume}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              {t('goal_resume')}
            </button>
          )}
        </div>
      )}

      {/* Image banner (only if image is set) */}
      {goal.image_url && (
        <div className="relative rounded-2xl overflow-hidden mb-6 h-48 md:h-64">
          <img src={goal.image_url} alt={goal.title} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="absolute bottom-4 start-5 end-5 text-white">
            <h1 className="text-2xl md:text-3xl font-extrabold drop-shadow-md">{goal.title}</h1>
            {goal.subtitle && <p className="text-sm text-white/90 mt-1 drop-shadow">{goal.subtitle}</p>}
          </div>
          {canEdit && (
            <div className="absolute top-3 end-3 flex items-center gap-2">
              {!goal.paused && (
                <button
                  onClick={() => setPauseOpen(true)}
                  className="p-2 rounded-full bg-white/90 hover:bg-white text-amber-700 shadow"
                  aria-label={t('goal_pause')}
                  title={t('goal_pause')}
                >
                  <PauseCircle className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setEditGoalOpen(true)}
                className="p-2 rounded-full bg-white/90 hover:bg-white text-gray-700 shadow"
                aria-label={t('edit')}
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => router.push('/goals')}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-3"
          >
            <ArrowIcon className="w-4 h-4" />
            {t('goal_back')}
          </button>
          {!goal.image_url && (
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 flex items-center gap-2">
                  <Target className="w-7 h-7 text-indigo-500" />
                  {goal.title}
                </h1>
                {goal.subtitle && <p className="text-sm text-gray-500 mt-1">{goal.subtitle}</p>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  {!goal.paused && (
                    <button
                      onClick={() => setPauseOpen(true)}
                      className="p-2 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-700"
                      aria-label={t('goal_pause')}
                      title={t('goal_pause')}
                    >
                      <PauseCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditGoalOpen(true)}
                    className="p-2 rounded-full bg-gray-50 hover:bg-gray-100 text-gray-700"
                    aria-label={t('edit')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-600">
            {goal.owner && (
              <span className="inline-flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                  {goal.owner.avatar_url
                    ? <img src={goal.owner.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-[10px] font-bold text-gray-500">{(goal.owner.full_name || goal.owner.email || 'U')[0].toUpperCase()}</span>}
                </div>
                {t('goal_owner')}: <strong>{goal.owner.full_name || goal.owner.email?.split('@')[0]}</strong>
              </span>
            )}
            {(goal.start_date || goal.end_date) && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {goal.start_date} {goal.end_date && `— ${goal.end_date}`}
              </span>
            )}
            {goal.departments && (
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                🏢 {goal.departments.name}
              </span>
            )}
            {goal.reward_points != null && goal.reward_points > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                <Award className="w-3 h-3" />+{goal.reward_points} {t('points_unit')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress summary */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 p-5 mb-6 border border-blue-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {t('goal_progress_label')}: <strong className="text-indigo-700 tabular-nums">{progress}%</strong>
          </span>
          <span className="text-sm text-gray-600">
            {done} / {total} {t('goal_milestones')}
          </span>
        </div>
        <div className="h-2 bg-white rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        {progress === 100 && total > 0 && (
          <p className="mt-3 text-xs font-medium text-emerald-700 flex items-center gap-1">
            <Flag className="w-3.5 h-3.5" />{t('goal_completed_celebrate')}
          </p>
        )}
      </div>

      {/* Roadmap (scooter path) */}
      {total === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <Flag className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <h3 className="text-base font-semibold text-gray-900">{t('goal_no_milestones')}</h3>
          <p className="text-sm text-gray-400 mt-1">{t('goal_no_milestones_hint')}</p>
          {canEdit && (
            <button
              onClick={() => setAddMilestoneOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" />{t('goal_add_milestone')}
            </button>
          )}
        </div>
      ) : (
        <>
          <Roadmap
            steps={steps}
            isStepDone={stepIsDone}
            currentPos={currentPos}
            onToggleManual={toggleStepManually}
            canEdit={canEdit}
            onAdd={() => setAddMilestoneOpen(true)}
          />

          {/* Milestone cards with tasks */}
          <div className="mt-6 space-y-4">
            {steps.map((s, i) => (
              <MilestoneCard
                key={s.id}
                index={i}
                step={s}
                isDone={stepIsDone(s)}
                isCurrent={i === currentPos}
                canEdit={canEdit}
                pointsPerTask={pointsPerTask}
                allMembers={allMembers}
                onAddTask={(title) => addTask(s.id, title)}
                onToggleTask={(task) => toggleTask(s.id, task)}
                onRemoveTask={(taskId) => removeTask(s.id, taskId)}
                onAssignTask={(taskId, mode) => assignTask(s.id, taskId, mode)}
                onEditStep={() => { setEditingStep(s); setEditStepTitle(s.title) }}
                onRemoveStep={() => removeStep(s.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Add milestone dialog */}
      <Dialog open={addMilestoneOpen} onOpenChange={setAddMilestoneOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('goal_add_milestone')}</DialogTitle></DialogHeader>
          <form onSubmit={addMilestone} className="space-y-3 mt-2">
            <Input value={milestoneTitle} onChange={e => setMilestoneTitle(e.target.value)} placeholder={t('goal_milestone_ph')} required autoFocus />
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit milestone title dialog */}
      <Dialog open={!!editingStep} onOpenChange={(o) => !o && setEditingStep(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('edit')}</DialogTitle></DialogHeader>
          <form onSubmit={saveEditStep} className="space-y-3 mt-2">
            <Input value={editStepTitle} onChange={e => setEditStepTitle(e.target.value)} autoFocus />
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit goal dialog */}
      <EditGoalDialog
        open={editGoalOpen}
        onOpenChange={setEditGoalOpen}
        goal={goal}
        onSaved={onGoalSaved}
      />

      {/* Pause goal dialog */}
      <Dialog open={pauseOpen} onOpenChange={(v) => { setPauseOpen(v); if (!v) setPauseReason('') }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PauseCircle className="w-5 h-5 text-amber-600" />
              {t('goal_pause')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handlePause} className="space-y-4 mt-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('goal_pause_reason')} *</label>
              <textarea
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder={t('goal_pause_reason_ph')}
                rows={4}
                required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-400 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPauseOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={pausing || !pauseReason.trim()} className="bg-amber-600 hover:bg-amber-700 text-white">
                {pausing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : <><PauseCircle className="w-4 h-4 mr-2" />{t('goal_pause')}</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ----- Milestone card with tasks -----

function MilestoneCard({
  index, step, isDone, isCurrent, canEdit, pointsPerTask, allMembers,
  onAddTask, onToggleTask, onRemoveTask, onAssignTask, onEditStep, onRemoveStep,
}: {
  index: number
  step: GoalStep
  isDone: boolean
  isCurrent: boolean
  canEdit: boolean
  pointsPerTask: number
  allMembers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  onAddTask: (title: string) => void
  onToggleTask: (task: GoalStepTask) => void
  onRemoveTask: (taskId: string) => void
  onAssignTask: (taskId: string, mode: 'unassigned' | 'everyone' | { userId: string }) => void
  onEditStep: () => void
  onRemoveStep: () => void
}) {
  const { t } = useLanguage()
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const tasks = [...(step.goal_step_tasks ?? [])].sort((a, b) => a.position - b.position)
  const doneCount = tasks.filter(t => t.completed).length

  async function submitTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    setAdding(true)
    await onAddTask(newTaskTitle)
    setNewTaskTitle('')
    setAdding(false)
  }

  return (
    <div className={`rounded-2xl border bg-white overflow-hidden transition-colors ${
      isDone ? 'border-emerald-200' : isCurrent ? 'border-blue-200 shadow-sm' : 'border-gray-100'
    }`}>
      <div className="p-4 flex items-center gap-3">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isDone ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
        }`}>
          {isDone ? <Check className="w-4 h-4" strokeWidth={3} /> : index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 truncate">{step.title}</h4>
            {isCurrent && !isDone && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                {t('goal_milestone_current')}
              </span>
            )}
          </div>
          {tasks.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <ListChecks className="w-3 h-3" />
              {doneCount} / {tasks.length} {t('goal_tasks')}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button onClick={onEditStep} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <Edit className="w-3.5 h-3.5" />
            </button>
            <button onClick={onRemoveStep} className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-600">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {(tasks.length > 0 || canEdit) && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 bg-gray-50/40">
          <ul className="space-y-1 mb-2">
            {tasks.map(t2 => (
              <li key={t2.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-white transition-colors group">
                <button
                  onClick={() => onToggleTask(t2)}
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    t2.completed ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-emerald-400'
                  }`}
                  aria-label="toggle"
                >
                  {t2.completed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>
                <span className={`text-sm flex-1 ${t2.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                  {t2.title}
                </span>
                {/* Assignee selector */}
                {canEdit ? (
                  <select
                    value={t2.assigned_to_everyone ? '__everyone__' : (t2.assigned_user_id || '')}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '__everyone__') onAssignTask(t2.id, 'everyone')
                      else if (v === '') onAssignTask(t2.id, 'unassigned')
                      else onAssignTask(t2.id, { userId: v })
                    }}
                    className="h-7 text-xs rounded-md border border-gray-200 bg-white px-2 max-w-[120px] truncate"
                    title={t('goal_assignee')}
                  >
                    <option value="">— {t('goal_unassigned')} —</option>
                    <option value="__everyone__">🌍 {t('goal_everyone')}</option>
                    {allMembers.map(m => (
                      <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                    ))}
                  </select>
                ) : t2.assigned_to_everyone ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                    🌍 {t('goal_everyone')}
                  </span>
                ) : t2.assigned_user_id && (() => {
                  const a = allMembers.find(m => m.id === t2.assigned_user_id)
                  return a ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 max-w-[120px] truncate" title={a.full_name || a.email}>
                      <div className="w-4 h-4 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                        {a.avatar_url
                          ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <span className="text-[8px] font-bold leading-4 block text-center">{(a.full_name || a.email || 'U')[0].toUpperCase()}</span>}
                      </div>
                      <span className="truncate">{a.full_name || a.email?.split('@')[0]}</span>
                    </span>
                  ) : null
                })()}
                {pointsPerTask > 0 && !t2.assigned_to_everyone && (
                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full ${
                    t2.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    <Award className="w-3 h-3" />+{pointsPerTask}
                  </span>
                )}
                {t2.assigned_to_everyone && (
                  <span className="inline-flex items-center text-[11px] font-medium text-gray-400 italic">
                    {t('goal_no_points')}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => onRemoveTask(t2.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 hover:text-red-500 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form onSubmit={submitTask} className="flex items-center gap-2">
              <input
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder={t('goal_task_ph')}
                className="flex-1 h-8 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-300"
              />
              <button
                type="submit"
                disabled={!newTaskTitle.trim() || adding}
                className="h-8 px-3 rounded-md bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1"
              >
                {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                {t('goal_add_task')}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ----- Roadmap path -----

function Roadmap({
  steps, isStepDone, currentPos, onToggleManual, canEdit, onAdd,
}: {
  steps: GoalStep[]
  isStepDone: (s: GoalStep) => boolean
  currentPos: number
  onToggleManual: (s: GoalStep) => void
  canEdit: boolean
  onAdd: () => void
}) {
  const { t } = useLanguage()
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="p-5 flex items-center justify-between border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Flag className="w-4 h-4 text-blue-500" />
          {t('goal_roadmap_title')}
        </h3>
        {canEdit && (
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />{t('goal_add_milestone')}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="p-8 overflow-x-auto">
        <div className="relative" style={{ minWidth: `${Math.max(600, steps.length * 180 + 120)}px` }}>
          <svg className="absolute inset-x-0 top-24 w-full h-16" preserveAspectRatio="none" viewBox={`0 0 ${Math.max(600, steps.length * 180 + 120)} 64`}>
            <path
              d={buildRoadPath(Math.max(600, steps.length * 180 + 120))}
              stroke="#CBD5E1"
              strokeWidth="3"
              strokeDasharray="4 8"
              fill="none"
            />
          </svg>

          <div className="relative flex items-start justify-between gap-6 pt-16">
            {steps.map((s, i) => {
              const isDone = isStepDone(s)
              const isCurrent = i === currentPos
              const tasksCount = (s.goal_step_tasks ?? []).length
              return (
                <div key={s.id} className="flex flex-col items-center flex-1 min-w-[140px] text-center">
                  {isCurrent && (
                    <div className="mb-2 animate-bounce-slow">
                      <ScooterIcon />
                    </div>
                  )}

                  <button
                    onClick={() => onToggleManual(s)}
                    disabled={tasksCount > 0}
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-sm ${
                      isDone
                        ? 'bg-emerald-500 text-white ring-4 ring-emerald-100'
                        : isCurrent
                          ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white ring-4 ring-blue-100 animate-pulse-slow'
                          : 'bg-gray-100 text-gray-400 ring-4 ring-gray-50'
                    } ${tasksCount > 0 ? 'cursor-default' : 'hover:opacity-90'}`}
                    title={tasksCount > 0 ? t('goal_has_tasks_hint') : isDone ? t('goal_milestone_done') : t('goal_milestone_click_to_complete')}
                  >
                    {isDone ? <Check className="w-7 h-7" strokeWidth={3} /> : <span className="text-sm font-bold">{i + 1}</span>}
                  </button>

                  <div className="mt-3 max-w-[160px]">
                    <p className={`text-sm font-semibold truncate ${isDone ? 'text-gray-900' : isCurrent ? 'text-indigo-700' : 'text-gray-500'}`}>
                      {s.title}
                    </p>
                    {tasksCount > 0 && (
                      <span className="inline-block mt-1 text-[10px] text-gray-500">
                        {(s.goal_step_tasks ?? []).filter(t => t.completed).length}/{tasksCount}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            <div className="flex flex-col items-center flex-shrink-0 pt-0">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ring-4 ${
                currentPos >= steps.length
                  ? 'bg-amber-400 ring-amber-100 text-white animate-bounce-slow'
                  : 'bg-gray-100 ring-gray-50 text-gray-300'
              }`}>
                <Flag className="w-7 h-7" />
              </div>
              <p className={`text-xs font-semibold mt-3 ${currentPos >= steps.length ? 'text-amber-600' : 'text-gray-400'}`}>
                {t('goal_finish_line')}
              </p>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .animate-bounce-slow { animation: bounce-slow 1.6s ease-in-out infinite; }
        @keyframes pulse-slow { 0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.35); } 50% { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0); } }
        .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

function buildRoadPath(width: number): string {
  const mid = 32
  const amp = 10
  const points: string[] = [`M 0 ${mid}`]
  const segments = Math.max(4, Math.floor(width / 100))
  for (let i = 1; i <= segments; i++) {
    const x = (width * i) / segments
    const y = mid + (i % 2 === 0 ? amp : -amp)
    const cx1 = x - (width / segments) * 0.6
    const cy1 = i % 2 === 0 ? mid - amp : mid + amp
    points.push(`Q ${cx1} ${cy1} ${x} ${y}`)
  }
  return points.join(' ')
}

function ScooterIcon() {
  return (
    <div className="relative w-14 h-14 flex items-center justify-center drop-shadow-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/scooter.png"
        alt=""
        className="w-14 h-14 object-contain"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          const sib = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement | null
          if (sib) sib.style.display = 'flex'
        }}
      />
      <span className="hidden w-14 h-14 rounded-full bg-sky-100 items-center justify-center text-2xl">🛵</span>
    </div>
  )
}
