'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, CheckSquare, Clock, Trash2, Check, Loader2, RefreshCw, Zap, Briefcase, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { arSA } from 'date-fns/locale'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface DailyTask {
  id: string
  title: string
  description: string | null
  completed: boolean
  expires_at: string
  created_at: string
  created_by: string
  task_type: 'recurring' | 'one_time'
  profiles: { full_name: string | null; avatar_url: string | null } | null
}

interface MyTask {
  source: 'project' | 'department' | 'goal'
  id: string
  title: string
  description: string | null
  done: boolean
  points: number
  containerHref: string | null
  containerName: string | null
}

interface DailyTasksClientProps {
  tasks: DailyTask[]
  profile: Profile
  departments: { id: string; name: string }[]
  myTasks: MyTask[]
}

function TaskCard({ task, onToggle, onDelete, canDelete }: {
  task: DailyTask
  onToggle: (id: string, completed: boolean) => void
  onDelete: (id: string) => void
  canDelete: boolean
}) {
  const { t, lang } = useLanguage()
  // Compute the relative time only after mount to avoid SSR/client hydration mismatch.
  const [relativeTime, setRelativeTime] = useState('')
  useEffect(() => {
    const update = () => setRelativeTime(
      formatDistanceToNow(new Date(task.expires_at), { addSuffix: true, locale: lang === 'ar' ? arSA : undefined }),
    )
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [task.expires_at, lang])
  return (
    <Card className={`border-0 shadow-sm transition-all ${task.completed ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => onToggle(task.id, task.completed)}
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
              task.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-green-400'
            }`}
          >
            {task.completed && <Check className="w-3 h-3 text-white" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-sm ${task.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {task.title}
            </p>
            {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1" suppressHydrationWarning>
              <Clock className="w-3 h-3" />
              {t('daily_task_expires')} {relativeTime}
            </p>
          </div>
          {canDelete && (
            <button
              onClick={() => onDelete(task.id)}
              className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function DailyTasksClient({ tasks: initialTasks, profile, departments, myTasks: initialMyTasks }: DailyTasksClientProps) {
  const { t, isRtl } = useLanguage()
  const [tasks, setTasks] = useState(initialTasks)
  const [myTasks, setMyTasks] = useState(initialMyTasks)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [taskType, setTaskType] = useState<'recurring' | 'one_time'>('one_time')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'recurring' | 'one_time' | 'mine'>('recurring')
  const supabase = createClient()

  // Any authenticated user can add daily tasks.
  const canCreate = true
  const isAdmin = ['super_admin', 'project_manager'].includes(profile.role)

  const recurringTasks = tasks.filter(t => t.task_type === 'recurring')
  const oneTimeTasks = tasks.filter(t => t.task_type === 'one_time')
  const currentTasks = activeTab === 'recurring' ? recurringTasks : oneTimeTasks
  const pending = currentTasks.filter(t => !t.completed)
  const completed = currentTasks.filter(t => t.completed)

  // Toggle a task in the "Mine" tab. Each source maps to a different table:
  //   project    → tasks.status         (done | backlog)
  //   department → department_recurring_completions row for today
  //   goal       → goal_step_tasks.completed
  // We optimistically flip local state, then revert on error so the UI
  // stays responsive without re-fetching.
  async function handleMyToggle(taskId: string, source: 'project' | 'department' | 'goal', currentDone: boolean) {
    const next = !currentDone
    setMyTasks(prev => prev.map(t =>
      t.id === taskId && t.source === source ? { ...t, done: next } : t
    ))

    let error: { message: string } | null = null
    if (source === 'project') {
      const res = await supabase.from('tasks').update({ status: next ? 'done' : 'backlog' }).eq('id', taskId)
      error = res.error
    } else if (source === 'goal') {
      const res = await supabase.from('goal_step_tasks').update({ completed: next }).eq('id', taskId)
      error = res.error
    } else {
      // department: insert/delete a completion row for today
      const today = new Date().toISOString().slice(0, 10)
      if (next) {
        const res = await supabase.from('department_recurring_completions').insert({
          task_id: taskId, user_id: profile.id, completed_date: today,
        })
        error = res.error
      } else {
        const res = await supabase.from('department_recurring_completions')
          .delete()
          .eq('task_id', taskId)
          .eq('user_id', profile.id)
          .eq('completed_date', today)
        error = res.error
      }
    }

    if (error) {
      // Revert the optimistic flip if the DB rejected us.
      setMyTasks(prev => prev.map(t =>
        t.id === taskId && t.source === source ? { ...t, done: currentDone } : t
      ))
      toast.error(error.message)
    }
  }

  async function logAudit(action_type: string, object_name: string, object_id: string) {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_name: profile.full_name ?? null,
        user_email: profile.email ?? null,
        action_type,
        object_type: 'daily_task',
        object_name,
        object_id,
      }),
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('daily_tasks')
      .insert({ title, description, created_by: profile.id, expires_at: expiresAt, task_type: taskType })
      .select(`*, profiles!assigned_user_id(full_name, avatar_url)`)
      .single()

    if (error) { toast.error('Failed to create task') }
    else {
      setTasks([data, ...tasks])
      setCreateOpen(false)
      setTitle(''); setDescription('')
      setActiveTab(taskType)
      toast.success(t('daily_task_new'))
      await logAudit('add', title, data.id)
    }
    setLoading(false)
  }

  async function handleToggle(id: string, completed: boolean) {
    const { error } = await supabase
      .from('daily_tasks')
      .update({ completed: !completed })
      .eq('id', id)

    if (error) { toast.error('Failed to update task') }
    else { setTasks(tasks.map(t => t.id === id ? { ...t, completed: !completed } : t)) }
  }

  async function handleDelete(id: string) {
    const task = tasks.find(t => t.id === id)
    const { error } = await supabase.from('daily_tasks').delete().eq('id', id)
    if (error) { toast.error('Failed to delete') }
    else {
      setTasks(tasks.filter(t => t.id !== id))
      toast.success('Task deleted')
      await logAudit('delete', task?.title ?? id, id)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('daily_tasks_title')}</h1>
          <p className="text-gray-500 mt-1 text-sm">{t('daily_task_recurring_hint')} · {t('daily_task_one_time_hint')}</p>
        </div>
        {canCreate && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" />{t('daily_task_new')}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t('daily_task_new')}</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>{t('title')}</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('title')} required />
                </div>
                <div className="space-y-2">
                  <Label>{t('description')} ({t('optional')})</Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>{t('daily_task_type')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTaskType('recurring')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-sm ${
                        taskType === 'recurring'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span className="font-medium">{t('daily_task_recurring')}</span>
                      <span className="text-xs opacity-70">{t('daily_task_recurring_hint')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskType('one_time')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-sm ${
                        taskType === 'one_time'
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Zap className="w-4 h-4" />
                      <span className="font-medium">{t('daily_task_one_time')}</span>
                      <span className="text-xs opacity-70">{t('daily_task_one_time_hint')}</span>
                    </button>
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('create')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6">
        <button
          onClick={() => setActiveTab('recurring')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            activeTab === 'recurring'
              ? 'bg-white shadow text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('daily_task_recurring')}
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'recurring' ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
            {recurringTasks.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('one_time')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            activeTab === 'one_time'
              ? 'bg-white shadow text-orange-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          {t('daily_task_one_time')}
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'one_time' ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-500'}`}>
            {oneTimeTasks.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('mine')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
            activeTab === 'mine'
              ? 'bg-white shadow text-purple-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          {t('daily_task_mine')}
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'mine' ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-500'}`}>
            {myTasks.length}
          </span>
        </button>
      </div>

      {activeTab === 'mine' ? (
        myTasks.length === 0 ? (
          <div className="text-center py-24">
            <Briefcase className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('daily_task_mine_empty_title')}</h3>
            <p className="text-gray-400 text-sm">{t('daily_task_mine_empty_hint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myTasks.map(pt => (
              <MyTaskCard
                key={`${pt.source}:${pt.id}`}
                task={pt}
                t={t}
                onToggle={() => handleMyToggle(pt.id, pt.source, pt.done)}
              />
            ))}
          </div>
        )
      ) : currentTasks.length === 0 ? (
        <div className="text-center py-24">
          <CheckSquare className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('no_data')}</h3>
          <p className="text-gray-400 text-sm">
            {activeTab === 'recurring' ? t('daily_task_recurring_hint') : t('daily_task_one_time_hint')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wide">{t('status_pending')} ({pending.length})</h2>
              <div className="space-y-2">{pending.map(task => <TaskCard key={task.id} task={task} onToggle={handleToggle} onDelete={handleDelete} canDelete={isAdmin || task.created_by === profile.id} />)}</div>
            </div>
          )}
          {completed.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-3 uppercase tracking-wide">{t('daily_task_complete')} ({completed.length})</h2>
              <div className="space-y-2">{completed.map(task => <TaskCard key={task.id} task={task} onToggle={handleToggle} onDelete={handleDelete} canDelete={isAdmin || task.created_by === profile.id} />)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MyTaskCard({ task, t, onToggle }: {
  task: MyTask
  t: (k: 'pts' | 'daily_task_source_project' | 'daily_task_source_department' | 'daily_task_source_goal' | 'daily_task_no_container') => string
  onToggle: () => void
}) {
  const isDone = task.done
  const sourceStyle =
    task.source === 'project'
      ? { label: t('daily_task_source_project'), classes: 'text-purple-700 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-100 hover:bg-purple-100' }
      : task.source === 'department'
      ? { label: t('daily_task_source_department'), classes: 'text-emerald-700 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100 hover:bg-emerald-100' }
      : { label: t('daily_task_source_goal'), classes: 'text-amber-700 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-100 hover:bg-amber-100' }

  return (
    <Card className={`border-0 shadow-sm transition-all ${isDone ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <button
            onClick={onToggle}
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
              isDone ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-green-400'
            }`}
            aria-label="toggle"
          >
            {isDone && <Check className="w-3 h-3 text-white" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.title}</p>
            {task.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{task.description}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${sourceStyle.classes.replace(/hover:bg-\S+/, '').trim()}`}>
                {sourceStyle.label}
              </span>
              {task.containerName && task.containerHref ? (
                <Link
                  href={task.containerHref}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 ${sourceStyle.classes}`}
                >
                  <Briefcase className="w-3 h-3" />
                  {task.containerName}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 italic">{t('daily_task_no_container')}</span>
              )}
              {task.points > 0 && (
                <span className="inline-flex items-center text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
                  +{task.points} {t('pts')}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
