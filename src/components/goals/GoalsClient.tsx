'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Plus, Target, Check, Globe, Building2, Trash2, Loader2, X, Users, Edit } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface GoalStep {
  id: string
  title: string
  completed: boolean
  position: number
}

interface GoalMember {
  user_id: string
  profiles: { id: string; full_name: string | null; avatar_url: string | null }
}

interface Goal {
  id: string
  title: string
  description: string | null
  is_global: boolean
  completed: boolean
  department_id: string | null
  goal_steps: GoalStep[]
  goal_members: GoalMember[]
  departments: { name: string } | null
}

interface SimpleProfile {
  id: string
  full_name: string | null
  email?: string
  avatar_url: string | null
}

interface GoalsClientProps {
  goals: Goal[]
  profile: Profile
  departments: { id: string; name: string }[]
  allProfiles: SimpleProfile[]
}

// ─── Goal Card ────────────────────────────────────────────────────────────────
function GoalCard({
  goal,
  onDelete,
  onToggleStep,
  onEdit,
  isSuperAdmin,
}: {
  goal: Goal
  onDelete: (id: string) => void
  onToggleStep: (goalId: string, stepId: string, completed: boolean) => void
  onEdit: (goal: Goal) => void
  isSuperAdmin: boolean
}) {
  const { t } = useLanguage()
  const progress =
    goal.goal_steps.length === 0
      ? goal.completed ? 100 : 0
      : Math.round((goal.goal_steps.filter(s => s.completed).length / goal.goal_steps.length) * 100)

  const members = goal.goal_members ?? []

  return (
    <Card className={`border-0 shadow-sm ${goal.completed ? 'opacity-70' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {goal.is_global ? (
              <Globe className="w-4 h-4 text-blue-500 flex-shrink-0" />
            ) : (
              <Building2 className="w-4 h-4 text-violet-500 flex-shrink-0" />
            )}
            <CardTitle className={`text-sm font-semibold truncate ${goal.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {goal.title}
            </CardTitle>
          </div>
          {isSuperAdmin && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => onEdit(goal)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors">
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(goal.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {goal.description && <p className="text-xs text-gray-500 mt-1">{goal.description}</p>}
        {!goal.is_global && goal.departments && (
          <p className="text-xs text-violet-600 font-medium mt-1">{goal.departments.name}</p>
        )}
      </CardHeader>
      <CardContent>
        {/* Assigned Members */}
        {members.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <Users className="w-3 h-3 text-gray-400" />
            <div className="flex -space-x-1">
              {members.slice(0, 5).map(m => (
                <div
                  key={m.user_id}
                  title={m.profiles?.full_name || ''}
                  className="w-5 h-5 rounded-full bg-gray-200 border border-white flex items-center justify-center overflow-hidden flex-shrink-0"
                >
                  {m.profiles?.avatar_url ? (
                    <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[9px] font-bold text-gray-600">
                      {(m.profiles?.full_name || 'U')[0].toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
              {members.length > 5 && (
                <div className="w-5 h-5 rounded-full bg-gray-100 border border-white flex items-center justify-center">
                  <span className="text-[9px] font-bold text-gray-500">+{members.length - 5}</span>
                </div>
              )}
            </div>
            <span className="text-xs text-gray-400">{members.length} {t('goal_assigned')}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">{t('goal_progress')}</span>
          <span className="text-xs font-bold text-gray-700">{progress}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: progress === 100 ? '#22c55e' : '#6366f1',
            }}
          />
        </div>

        {/* Steps */}
        {goal.goal_steps.length > 0 && (
          <div className="space-y-1.5">
            {goal.goal_steps.sort((a, b) => a.position - b.position).map(step => (
              <button
                key={step.id}
                onClick={() => onToggleStep(goal.id, step.id, step.completed)}
                className="w-full flex items-center gap-2 text-left group"
              >
                <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${step.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 group-hover:border-green-400'}`}>
                  {step.completed && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className={`text-xs ${step.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{step.title}</span>
              </button>
            ))}
          </div>
        )}

        {progress === 100 && (
          <div className="mt-3 p-2 bg-green-50 border border-green-100 rounded-lg text-center">
            <p className="text-xs text-green-700 font-medium">🎉 {t('goal_completed')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Goal Form (shared for create + edit) ─────────────────────────────────────
function GoalForm({
  title, setTitle,
  description, setDescription,
  goalType, setGoalType,
  selectedDept, setSelectedDept,
  steps, setSteps,
  selectedUserIds, setSelectedUserIds,
  departments,
  allProfiles,
  loading,
  onSubmit,
  submitLabel,
}: {
  title: string; setTitle: (v: string) => void
  description: string; setDescription: (v: string) => void
  goalType: 'global' | 'department'; setGoalType: (v: 'global' | 'department') => void
  selectedDept: string; setSelectedDept: (v: string) => void
  steps: string[]; setSteps: (v: string[]) => void
  selectedUserIds: string[]; setSelectedUserIds: (v: string[]) => void
  departments: { id: string; name: string }[]
  allProfiles: SimpleProfile[]
  loading: boolean
  onSubmit: (e: React.FormEvent) => void
  submitLabel: string
}) {
  const { t } = useLanguage()
  return (
    <form onSubmit={onSubmit} className="space-y-4 mt-2">
      {/* Goal type toggle */}
      <div className="space-y-1.5">
        <Label>{t('goal_type_global')} / {t('goal_type_dept')}</Label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setGoalType('global')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${goalType === 'global' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            <Globe className="w-4 h-4" /> {t('goal_type_global')}
          </button>
          <button
            type="button"
            onClick={() => setGoalType('department')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${goalType === 'department' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            <Building2 className="w-4 h-4" /> {t('goal_type_dept')}
          </button>
        </div>
      </div>

      {/* Department selector */}
      {goalType === 'department' && (
        <div className="space-y-1.5">
          <Label>{t('goal_select_dept')}</Label>
          <select
            value={selectedDept}
            onChange={e => setSelectedDept(e.target.value)}
            required
            className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          >
            <option value="">{t('goal_select_dept')}...</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('title')}</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('title')} required />
      </div>
      <div className="space-y-1.5">
        <Label>{t('description')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
      </div>

      {/* Assigned Users */}
      <div className="space-y-1.5">
        <Label>{t('goal_assign_users')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
        <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
          {allProfiles.map(p => {
            const checked = selectedUserIds.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedUserIds(
                  checked ? selectedUserIds.filter(id => id !== p.id) : [...selectedUserIds, p.id]
                )}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${checked ? 'bg-blue-50' : ''}`}
              >
                <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${checked ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-bold text-gray-500">{(p.full_name || p.email || 'U')[0].toUpperCase()}</span>
                  )}
                </div>
                <span className="text-sm text-gray-700 truncate">{p.full_name || p.email}</span>
              </button>
            )
          })}
        </div>
        {selectedUserIds.length > 0 && (
          <p className="text-xs text-blue-600 font-medium">{selectedUserIds.length} {t('goal_assigned')}</p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        <Label>{t('goal_steps')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={s}
                onChange={e => setSteps(steps.map((v, j) => j === i ? e.target.value : v))}
                placeholder={`${t('step_placeholder')} ${i + 1}`}
              />
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSteps([...steps, ''])}
            className="text-sm text-blue-600 hover:underline"
          >
            + {t('goal_add_step')}
          </button>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{submitLabel}...</> : submitLabel}
      </Button>
    </form>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function GoalsClient({ goals: initGoals, profile, departments, allProfiles }: GoalsClientProps) {
  const { t, isRtl } = useLanguage()
  const [goals, setGoals] = useState(initGoals)
  const [createOpen, setCreateOpen] = useState(false)
  const [editGoal, setEditGoal] = useState<Goal | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const isSuperAdmin = profile?.role === 'super_admin'

  // Shared form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [goalType, setGoalType] = useState<'global' | 'department'>('global')
  const [selectedDept, setSelectedDept] = useState('')
  const [steps, setSteps] = useState([''])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  const globalGoals = goals.filter(g => g.is_global)
  const deptGoals = goals.filter(g => !g.is_global)

  function resetForm() {
    setTitle(''); setDescription(''); setGoalType('global'); setSelectedDept(''); setSteps(['']); setSelectedUserIds([])
  }

  function openEdit(goal: Goal) {
    setEditGoal(goal)
    setTitle(goal.title)
    setDescription(goal.description ?? '')
    setGoalType(goal.is_global ? 'global' : 'department')
    setSelectedDept(goal.department_id ?? '')
    setSteps(goal.goal_steps.length > 0 ? goal.goal_steps.sort((a, b) => a.position - b.position).map(s => s.title) : [''])
    setSelectedUserIds((goal.goal_members ?? []).map(m => m.user_id))
  }

  async function syncGoalMembers(goalId: string, userIds: string[]) {
    // Delete all existing members, then insert new ones
    await supabase.from('goal_members').delete().eq('goal_id', goalId)
    if (userIds.length > 0) {
      await supabase.from('goal_members').insert(userIds.map(uid => ({ goal_id: goalId, user_id: uid })))
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (goalType === 'department' && !selectedDept) { toast.error('Please select a department'); return }
    setLoading(true)

    const { data: goal, error } = await supabase
      .from('goals')
      .insert({
        title,
        description: description || null,
        is_global: goalType === 'global',
        department_id: goalType === 'department' ? selectedDept : null,
        created_by: profile.id,
      })
      .select(`*, goal_steps(*), departments(name)`)
      .single()

    if (error) { toast.error('Failed to create goal'); setLoading(false); return }

    const validSteps = steps.filter(s => s.trim())
    if (validSteps.length > 0) {
      const { data: newSteps } = await supabase
        .from('goal_steps')
        .insert(validSteps.map((s, i) => ({ goal_id: goal.id, title: s, position: i })))
        .select()
      if (newSteps) goal.goal_steps = newSteps
    }

    // Assign members
    let goal_members: GoalMember[] = []
    if (selectedUserIds.length > 0) {
      await supabase.from('goal_members').insert(selectedUserIds.map(uid => ({ goal_id: goal.id, user_id: uid })))
      goal_members = selectedUserIds.map(uid => {
        const p = allProfiles.find(ap => ap.id === uid)
        return { user_id: uid, profiles: { id: uid, full_name: p?.full_name ?? null, avatar_url: p?.avatar_url ?? null } }
      })
    }

    setGoals([{ ...goal, goal_members }, ...goals])
    setCreateOpen(false)
    resetForm()
    toast.success('Goal created!')
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editGoal) return
    if (goalType === 'department' && !selectedDept) { toast.error('Please select a department'); return }
    setLoading(true)

    const { error } = await supabase
      .from('goals')
      .update({
        title,
        description: description || null,
        is_global: goalType === 'global',
        department_id: goalType === 'department' ? selectedDept : null,
      })
      .eq('id', editGoal.id)

    if (error) { toast.error('Failed to update goal'); setLoading(false); return }

    // Update steps: delete all and re-insert
    await supabase.from('goal_steps').delete().eq('goal_id', editGoal.id)
    const validSteps = steps.filter(s => s.trim())
    let newStepsData: GoalStep[] = []
    if (validSteps.length > 0) {
      const { data } = await supabase
        .from('goal_steps')
        .insert(validSteps.map((s, i) => ({ goal_id: editGoal.id, title: s, position: i })))
        .select()
      if (data) newStepsData = data
    }

    // Sync members
    await syncGoalMembers(editGoal.id, selectedUserIds)
    const goal_members: GoalMember[] = selectedUserIds.map(uid => {
      const p = allProfiles.find(ap => ap.id === uid)
      return { user_id: uid, profiles: { id: uid, full_name: p?.full_name ?? null, avatar_url: p?.avatar_url ?? null } }
    })

    setGoals(goals.map(g => g.id === editGoal.id
      ? {
          ...g,
          title,
          description: description || null,
          is_global: goalType === 'global',
          department_id: goalType === 'department' ? selectedDept : null,
          goal_steps: newStepsData,
          goal_members,
        }
      : g
    ))
    setEditGoal(null)
    resetForm()
    toast.success('Goal updated!')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this goal?')) return
    await supabase.from('goals').delete().eq('id', id)
    setGoals(goals.filter(g => g.id !== id))
    toast.success('Goal deleted')
  }

  async function handleToggleStep(goalId: string, stepId: string, completed: boolean) {
    await supabase.from('goal_steps').update({ completed: !completed }).eq('id', stepId)
    setGoals(goals.map(g =>
      g.id === goalId
        ? { ...g, goal_steps: g.goal_steps.map(s => s.id === stepId ? { ...s, completed: !completed } : s) }
        : g
    ))
  }

  const EmptyState = ({ message }: { message: string }) => (
    <div className="text-center py-20">
      <Target className="w-12 h-12 text-gray-200 mx-auto mb-4" />
      <h3 className="text-base font-semibold text-gray-900 mb-1">{t('no_data')}</h3>
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  )

  const formProps = { title, setTitle, description, setDescription, goalType, setGoalType, selectedDept, setSelectedDept, steps, setSteps, selectedUserIds, setSelectedUserIds, departments, allProfiles, loading }

  return (
    <div className="p-8">
      {/* Header */}
      <div className={`flex items-center justify-between mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('goals_title')}</h1>
          <p className="text-gray-500 mt-1">
            {goals.filter(g => !g.completed).length} {t('goal_active')} · {goals.filter(g => g.completed).length} {t('goal_completed')}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => { resetForm(); setCreateOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('goal_new')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="global">
        <TabsList className="mb-6">
          <TabsTrigger value="global" className="flex items-center gap-1.5 text-sm">
            <Globe className="w-3.5 h-3.5" />
            {t('goal_global')}
            <span className="text-xs font-bold text-gray-400 ml-1">({globalGoals.length})</span>
          </TabsTrigger>
          <TabsTrigger value="department" className="flex items-center gap-1.5 text-sm">
            <Building2 className="w-3.5 h-3.5" />
            {t('goal_department')}
            <span className="text-xs font-bold text-gray-400 ml-1">({deptGoals.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global">
          {globalGoals.length === 0 ? (
            <EmptyState message={t('goal_global')} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {globalGoals.map(goal => (
                <GoalCard key={goal.id} goal={goal} onDelete={handleDelete} onToggleStep={handleToggleStep} onEdit={openEdit} isSuperAdmin={isSuperAdmin} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="department">
          {deptGoals.length === 0 ? (
            <EmptyState message={t('goal_department')} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {deptGoals.map(goal => (
                <GoalCard key={goal.id} goal={goal} onDelete={handleDelete} onToggleStep={handleToggleStep} onEdit={openEdit} isSuperAdmin={isSuperAdmin} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('goal_new')}</DialogTitle></DialogHeader>
          <GoalForm {...formProps} onSubmit={handleCreate} submitLabel={t('create')} />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editGoal} onOpenChange={open => { if (!open) { setEditGoal(null); resetForm() } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('edit')}</DialogTitle></DialogHeader>
          <GoalForm {...formProps} onSubmit={handleEdit} submitLabel={t('save')} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
