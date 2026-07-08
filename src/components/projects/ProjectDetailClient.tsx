'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  ArrowLeft, Plus, Loader2, GripVertical, Edit, Trash2, Zap, FolderKanban, Trophy, BarChart3,
  CheckSquare, Check, Square,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { logAudit } from '@/lib/audit'

type TaskStatus = string

interface Column {
  id: string
  name: string
}

const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'in_progress', name: 'In Progress' },
  { id: 'testing', name: 'Testing' },
  { id: 'done', name: 'Done' },
]

const COLOR_PALETTE = [
  { color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  { color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  { color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  { color: 'bg-pink-100 text-pink-700', dot: 'bg-pink-500' },
  { color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  { color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
]

interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  points: number
  position: number
  assigned_user_id: string | null
  points_awarded: boolean
  profiles: { id: string; full_name: string | null; avatar_url: string | null } | null
}

interface Member {
  user_id: string
  profiles: { id: string; full_name: string | null; avatar_url: string | null }
}

interface ProjectAchievement {
  id: string
  title: string
  description: string | null
  achievement_date: string | null
  created_at: string
}

interface ProjectEvalCriteria {
  id: string
  type: 'excellent' | 'poor'
  criteria: string
}

interface ChecklistItem {
  id: string
  title: string
  description: string | null
  completed: boolean
  created_at: string
}

interface Project {
  id: string
  name: string
  description: string | null
  status: string
  departments: { id: string; name: string } | null
  columns: Column[] | null
}

// ─── Droppable Column Wrapper ─────────────────────────────────────────────────
function DroppableColumn({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors ${isOver ? 'bg-blue-50 ring-2 ring-blue-200' : ''}`}
    >
      {children}
    </div>
  )
}

// ─── Sortable Task Card ───────────────────────────────────────────────────────
function TaskCard({
  task,
  onEdit,
  onDelete,
  onInlineRename,
  canManage,
}: {
  task: Task
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  onInlineRename: (id: string, title: string) => void
  canManage: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  })
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(task.title)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function commitRename() {
    const trimmed = draftTitle.trim()
    if (trimmed && trimmed !== task.title) onInlineRename(task.id, trimmed)
    else setDraftTitle(task.title)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3"
    >
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 min-w-0">
          {/* Inline title editing */}
          {editing ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setDraftTitle(task.title); setEditing(false) }
              }}
              className="w-full text-sm font-medium text-gray-900 border-b border-blue-400 outline-none bg-transparent leading-snug pb-0.5"
            />
          ) : (
            <p
              className="text-sm font-medium text-gray-900 leading-snug cursor-text"
              onDoubleClick={() => canManage && setEditing(true)}
              title={canManage ? 'Double-click to rename' : undefined}
            >
              {task.title}
            </p>
          )}

          {task.description && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.description}</p>
          )}

          <div className="flex items-center justify-between mt-2.5">
            {/* Assignee */}
            {task.profiles ? (
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {task.profiles.avatar_url ? (
                    <img src={task.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-gray-500">
                      {(task.profiles.full_name || 'U')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400 truncate max-w-[70px]">
                  {task.profiles.full_name?.split(' ')[0]}
                </span>
              </div>
            ) : <div />}

            <div className="flex items-center gap-1">
              {task.points > 0 && (
                <span className={`flex items-center gap-0.5 text-xs font-bold ${task.points_awarded ? 'text-green-600' : 'text-amber-500'}`}>
                  <Zap className="w-3 h-3" />{task.points}
                </span>
              )}

              {canManage && !confirmDelete && (
                <>
                  <button
                    onClick={() => onEdit(task)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors"
                    title="Edit"
                  >
                    <Edit className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}

              {/* Inline delete confirmation */}
              {canManage && confirmDelete && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onDelete(task.id)}
                    className="px-1.5 py-0.5 rounded bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-xs font-semibold hover:bg-gray-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Quick Add Card ───────────────────────────────────────────────────────────
function QuickAddCard({
  onAdd,
}: {
  onAdd: (title: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) { setOpen(false); setValue(''); return }
    setSaving(true)
    await onAdd(trimmed)
    setValue('')
    setSaving(false)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors mt-1"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('task_add_card')}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-1.5">
      <textarea
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
          if (e.key === 'Escape') { setOpen(false); setValue('') }
        }}
        placeholder={t('task_card_name_ph')}
        rows={2}
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {t('task_add_card')}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setValue('') }}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          ✕
        </button>
      </div>
    </form>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ProjectDetailClient({
  project,
  tasks: initTasks,
  members,
  profile,
  achievements: initAchievements,
  evaluationCriteria: initCriteria,
  checklist: initChecklist,
}: {
  project: Project
  tasks: Task[]
  members: Member[]
  profile: Profile
  achievements: ProjectAchievement[]
  evaluationCriteria: ProjectEvalCriteria[]
  checklist: ChecklistItem[]
}) {
  const { t, isRtl } = useLanguage()

  const [projectColumns, setProjectColumns] = useState<Column[]>(
    project.columns && project.columns.length > 0 ? project.columns : DEFAULT_COLUMNS
  )
  const [manageColsOpen, setManageColsOpen] = useState(false)
  const [newColName, setNewColName] = useState('')
  const [editingColId, setEditingColId] = useState<string | null>(null)
  const [editingColName, setEditingColName] = useState('')

  const COLUMNS = projectColumns.map((col, i) => ({
    id: col.id,
    label: col.name,
    color: COLOR_PALETTE[i % COLOR_PALETTE.length].color,
    dot: COLOR_PALETTE[i % COLOR_PALETTE.length].dot,
  }))

  const [tasks, setTasks] = useState<Task[]>(initTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [addToColumn, setAddToColumn] = useState<TaskStatus>(
    (project.columns && project.columns.length > 0 ? project.columns[0].id : DEFAULT_COLUMNS[0].id)
  )
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskPoints, setTaskPoints] = useState('0')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [loading, setLoading] = useState(false)

  const router = useRouter()
  const supabase = createClient()
  const canManage = ['super_admin', 'project_manager'].includes(profile.role)

  // Achievements state
  const [achievements, setAchievements] = useState<ProjectAchievement[]>(initAchievements)
  const [addAchievementOpen, setAddAchievementOpen] = useState(false)
  const [achieveTitle, setAchieveTitle] = useState('')
  const [achieveDesc, setAchieveDesc] = useState('')
  const [achieveDate, setAchieveDate] = useState('')

  // Evaluation criteria state
  const [criteria, setCriteria] = useState<ProjectEvalCriteria[]>(initCriteria)
  const [addCriteriaOpen, setAddCriteriaOpen] = useState(false)
  const [criteriaType, setCriteriaType] = useState<'excellent' | 'poor'>('excellent')
  const [criteriaText, setCriteriaText] = useState('')

  // Checklist state
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initChecklist)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [editChecklistItem, setEditChecklistItem] = useState<ChecklistItem | null>(null)
  const [clTitle, setClTitle] = useState('')
  const [clDesc, setClDesc] = useState('')

  // Tab state
  const [activeTab, setActiveTab] = useState('board')

  const excellentCriteria = criteria.filter(c => c.type === 'excellent')
  const poorCriteria = criteria.filter(c => c.type === 'poor')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function getColTasks(status: TaskStatus) {
    return tasks.filter(t => t.status === status).sort((a, b) => a.position - b.position)
  }

  // ─── Drag handlers ──────────────────────────────────────────────────────────
  function handleDragStart({ active }: DragStartEvent) {
    setActiveTask(tasks.find(t => t.id === active.id) ?? null)
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    if (activeId === overId) return

    const activeTask = tasks.find(t => t.id === activeId)
    if (!activeTask) return

    // Determine the target status
    const overColumn = COLUMNS.find(c => c.id === overId)
    const overTask = tasks.find(t => t.id === overId)
    const targetStatus = (overColumn?.id ?? overTask?.status ?? activeTask.status) as TaskStatus

    if (activeTask.status !== targetStatus) {
      setTasks(prev =>
        prev.map(t => t.id === activeId ? { ...t, status: targetStatus } : t)
      )
    }
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null)
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string
    const task = tasks.find(t => t.id === activeId)
    if (!task) return

    const overColumn = COLUMNS.find(c => c.id === overId)
    const overTask = tasks.find(t => t.id === overId)
    const newStatus = (overColumn?.id ?? overTask?.status ?? task.status) as TaskStatus

    // Persist via API (uses admin client to reliably award points)
    const res = await fetch('/api/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: activeId, newStatus }),
    })

    const json = await res.json()

    if (!res.ok) {
      toast.error(`Failed to move task: ${json.error ?? res.status}`)
      setTasks(prev => prev.map(t => t.id === activeId ? { ...t, status: task.status } : t))
      return
    }

    if (json.pendingApproval && newStatus === 'done') {
      toast.success(`✅ ${t('task_done_toast')} — النقاط بانتظار موافقة المشرف`)
    } else if (newStatus === 'done' && task.points > 0) {
      toast.success(`✅ ${t('task_done_toast')}`)
    }
    setTasks(prev => prev.map(t => t.id === activeId ? { ...t, status: newStatus } : t))
  }

  // ─── Task CRUD ───────────────────────────────────────────────────────────────
  function openAddTask(col: TaskStatus) {
    setAddToColumn(col)
    setTaskTitle(''); setTaskDesc(''); setTaskPoints('0'); setTaskAssignee('')
    setAddTaskOpen(true)
  }

  function openEditTask(task: Task) {
    setEditTask(task)
    setTaskTitle(task.title)
    setTaskDesc(task.description ?? '')
    setTaskPoints(String(task.points))
    setTaskAssignee(task.assigned_user_id ?? '')
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const position = getColTasks(addToColumn).length
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        project_id: project.id,
        title: taskTitle,
        description: taskDesc || null,
        status: addToColumn,
        points: parseInt(taskPoints) || 0,
        assigned_user_id: taskAssignee || null,
        position,
        created_by: profile.id,
      })
      .select('*, profiles!assigned_user_id(id, full_name, avatar_url)')
      .single()

    if (error) { toast.error('Failed to create task') }
    else {
      setTasks(prev => [...prev, data])
      setAddTaskOpen(false)
      toast.success('Task created!')
      logAudit({ user_id: profile.id, user_name: profile.full_name, user_email: profile.email, action_type: 'add', object_type: 'task', object_name: taskTitle, object_id: data.id })
      if (taskAssignee && taskAssignee !== profile.id) {
        fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_id: taskAssignee,
            title: 'تم تعيين مهمة لك',
            message: `تم تعيينك في مهمة "${taskTitle}" بمشروع "${project.name}" من قِبل ${profile.full_name ?? 'مستخدم'}.`,
          }),
        }).catch(() => {})
      }
    }
    setLoading(false)
  }

  async function handleEditTask(e: React.FormEvent) {
    e.preventDefault()
    if (!editTask) return
    setLoading(true)
    const prevAssignee = editTask.assigned_user_id
    const { data, error } = await supabase
      .from('tasks')
      .update({
        title: taskTitle,
        description: taskDesc || null,
        points: parseInt(taskPoints) || 0,
        assigned_user_id: taskAssignee || null,
      })
      .eq('id', editTask.id)
      .select('*, profiles!assigned_user_id(id, full_name, avatar_url)')
      .single()

    if (error) { toast.error('Failed to update task') }
    else {
      setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, ...data } : t))
      setEditTask(null)
      toast.success('Updated!')
      logAudit({ user_id: profile.id, user_name: profile.full_name, user_email: profile.email, action_type: 'edit', object_type: 'task', object_name: taskTitle, object_id: editTask.id })
      // Notify new assignee if changed
      if (taskAssignee && taskAssignee !== profile.id && taskAssignee !== prevAssignee) {
        fetch('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_id: taskAssignee,
            title: 'تم تعيين مهمة لك',
            message: `تم تعيينك في مهمة "${taskTitle}" بمشروع "${project.name}" من قِبل ${profile.full_name ?? 'مستخدم'}.`,
          }),
        }).catch(() => {})
      }
    }
    setLoading(false)
  }

  async function handleDeleteTask(id: string) {
    const task = tasks.find(tk => tk.id === id)
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
    toast.success(t('delete'))
    logAudit({ user_id: profile.id, user_name: profile.full_name, user_email: profile.email, action_type: 'delete', object_type: 'task', object_name: task?.title ?? null, object_id: id })
  }

  async function handleQuickAdd(col: TaskStatus, title: string) {
    const position = getColTasks(col).length
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        project_id: project.id,
        title,
        description: null,
        status: col,
        points: 0,
        assigned_user_id: null,
        position,
        created_by: profile.id,
      })
      .select('*, profiles!assigned_user_id(id, full_name, avatar_url)')
      .single()

    if (error) { toast.error('Failed to create task') }
    else { setTasks(prev => [...prev, data]) }
  }

  async function saveColumns(cols: Column[]) {
    const { error } = await supabase.from('projects').update({ columns: cols }).eq('id', project.id)
    if (!error) setProjectColumns(cols)
  }

  async function handleAddColumn() {
    const name = newColName.trim()
    if (!name) return
    const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now()
    const newCols = [...projectColumns, { id, name }]
    await saveColumns(newCols)
    setNewColName('')
    toast.success(t('col_add'))
  }

  async function handleRenameColumn(id: string) {
    const name = editingColName.trim()
    if (!name) return
    const newCols = projectColumns.map(c => c.id === id ? { ...c, name } : c)
    await saveColumns(newCols)
    setEditingColId(null)
    toast.success(t('edit'))
  }

  async function handleDeleteColumn(id: string) {
    if (projectColumns.length <= 1) { toast.error(t('col_min_one')); return }
    if (tasks.some(task => task.status === id)) { toast.error(t('col_has_tasks')); return }
    const newCols = projectColumns.filter(c => c.id !== id)
    await saveColumns(newCols)
    toast.success(t('delete'))
  }

  async function handleInlineRename(id: string, title: string) {
    const { error } = await supabase.from('tasks').update({ title }).eq('id', id)
    if (error) { toast.error('Failed to rename'); return }
    setTasks(prev => prev.map(task => task.id === id ? { ...task, title } : task))
  }

  async function handleAddAchievement(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('project_achievements')
      .insert({ project_id: project.id, title: achieveTitle, description: achieveDesc || null, achievement_date: achieveDate || null, created_by: profile.id })
      .select().single()
    if (error) { toast.error('Failed to add achievement') }
    else { setAchievements([data, ...achievements]); setAddAchievementOpen(false); setAchieveTitle(''); setAchieveDesc(''); setAchieveDate('') }
    setLoading(false)
  }

  async function handleDeleteAchievement(id: string) {
    await supabase.from('project_achievements').delete().eq('id', id)
    setAchievements(achievements.filter(a => a.id !== id))
  }

  async function handleAddCriteria(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('project_evaluation_criteria')
      .insert({ project_id: project.id, type: criteriaType, criteria: criteriaText })
      .select().single()
    if (error) { toast.error('Failed to add criteria') }
    else { setCriteria([...criteria, data]); setAddCriteriaOpen(false); setCriteriaText('') }
    setLoading(false)
  }

  async function handleDeleteCriteria(id: string) {
    await supabase.from('project_evaluation_criteria').delete().eq('id', id)
    setCriteria(criteria.filter(c => c.id !== id))
  }

  // ─── Checklist handlers ───────────────────────────────────────────────────
  async function handleChecklistSave(e: React.FormEvent) {
    e.preventDefault()
    if (!clTitle.trim()) return
    setLoading(true)
    if (editChecklistItem) {
      const { data, error } = await supabase
        .from('project_checklist')
        .update({ title: clTitle.trim(), description: clDesc.trim() || null })
        .eq('id', editChecklistItem.id)
        .select().single()
      if (error) { toast.error('Failed to update'); setLoading(false); return }
      setChecklist(checklist.map(i => i.id === editChecklistItem.id ? data : i))
      logAudit({ user_id: profile.id, user_name: profile.full_name ?? null, user_email: profile.email, action_type: 'edit', object_type: 'checklist', object_name: clTitle.trim(), object_id: editChecklistItem.id })
    } else {
      const { data, error } = await supabase
        .from('project_checklist')
        .insert({ project_id: project.id, title: clTitle.trim(), description: clDesc.trim() || null, completed: false })
        .select().single()
      if (error) { toast.error('Failed to create'); setLoading(false); return }
      setChecklist([...checklist, data])
      logAudit({ user_id: profile.id, user_name: profile.full_name ?? null, user_email: profile.email, action_type: 'add', object_type: 'checklist', object_name: clTitle.trim(), object_id: data.id })
    }
    setChecklistOpen(false)
    setEditChecklistItem(null)
    setClTitle(''); setClDesc('')
    setLoading(false)
  }

  async function handleChecklistDelete(item: ChecklistItem) {
    await supabase.from('project_checklist').delete().eq('id', item.id)
    setChecklist(checklist.filter(i => i.id !== item.id))
    logAudit({ user_id: profile.id, user_name: profile.full_name ?? null, user_email: profile.email, action_type: 'delete', object_type: 'checklist', object_name: item.title, object_id: item.id })
  }

  async function handleChecklistToggle(item: ChecklistItem) {
    const { error } = await supabase
      .from('project_checklist')
      .update({ completed: !item.completed })
      .eq('id', item.id)
    if (!error) setChecklist(checklist.map(i => i.id === item.id ? { ...i, completed: !item.completed } : i))
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      {/* Header */}
      <div className={`px-6 py-3.5 border-b border-gray-100 bg-white flex-shrink-0 flex items-center gap-3 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900 truncate">{project.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${project.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {project.status === 'active' ? t('project_status_active') : project.status === 'completed' ? t('project_status_completed') : t('project_status_archived')}
            </span>
          </div>
          {project.departments && (
            <p className="text-xs text-blue-600 font-medium">{project.departments.name}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {tasks.length} {t('tasks_count')} · {tasks.filter(t => t.status === 'done').length} {t('done_count')}
          </span>
          {canManage && (
            <div className="flex items-center gap-2">
              {profile.role === 'super_admin' && (
                <button
                  onClick={() => setManageColsOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Edit className="w-3.5 h-3.5" />
                  {t('col_manage')}
                </button>
              )}
              <button
                onClick={() => openAddTask(projectColumns[0]?.id ?? 'backlog')}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('task_new')}
              </button>
            </div>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-2 border-b border-gray-100 bg-white flex-shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="about" className="text-xs px-3">{t('kanban_about')}</TabsTrigger>
            <TabsTrigger value="board" className="text-xs px-3">{t('kanban_board')}</TabsTrigger>
            <TabsTrigger value="checklist" className="text-xs px-3 flex items-center gap-1"><CheckSquare className="w-3 h-3" />{t('checklist_title')}</TabsTrigger>
            <TabsTrigger value="achievements" className="text-xs px-3 flex items-center gap-1"><Trophy className="w-3 h-3" />{t('achievements_title')}</TabsTrigger>
            <TabsTrigger value="evaluation" className="text-xs px-3 flex items-center gap-1"><BarChart3 className="w-3 h-3" />{t('evaluation_title')}</TabsTrigger>
          </TabsList>
        </div>

        {/* About */}
        <TabsContent value="about" className="flex-1 overflow-auto p-8">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-violet-600" /> {t('kanban_about')}
            </h2>
            <p className="text-gray-600 leading-relaxed">
              {project.description || <span className="text-gray-400 italic">No description.</span>}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4">
              {[
                { label: t('total'), value: tasks.length, color: 'bg-gray-50' },
                { label: t('col_in_progress'), value: tasks.filter(t => t.status === 'in_progress').length, color: 'bg-amber-50' },
                { label: t('col_done'), value: tasks.filter(t => t.status === 'done').length, color: 'bg-green-50' },
              ].map(s => (
                <div key={s.label} className={`${s.color} rounded-xl p-4`}>
                  <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Kanban Board */}
        <TabsContent value="board" className="flex-1 overflow-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 p-5 min-w-max h-full items-start">
              {COLUMNS.map(col => {
                const colTasks = getColTasks(col.id)
                return (
                  <div key={col.id} className="flex flex-col w-[272px] flex-shrink-0">
                    {/* Column header */}
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                        <span className="text-sm font-semibold text-gray-700">{col.label}</span>
                        <span className="text-xs font-bold text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{colTasks.length}</span>
                      </div>
                      {canManage && (
                        <button
                          onClick={() => openAddTask(col.id)}
                          className="w-6 h-6 rounded-md hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Droppable area */}
                    <DroppableColumn
                      id={col.id}
                      className="flex-1 min-h-[120px] rounded-xl p-2 space-y-2"
                    >
                      <SortableContext
                        items={colTasks.map(t => t.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {colTasks.map(task => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onEdit={openEditTask}
                            onDelete={handleDeleteTask}
                            onInlineRename={handleInlineRename}
                            canManage={canManage}
                          />
                        ))}
                      </SortableContext>
                      {colTasks.length === 0 && (
                        <div className="flex items-center justify-center h-20 border-2 border-dashed border-gray-200 rounded-lg">
                          <p className="text-xs text-gray-300">{t('drop_here')}</p>
                        </div>
                      )}
                    </DroppableColumn>

                    {/* Quick add */}
                    {canManage && (
                      <QuickAddCard onAdd={title => handleQuickAdd(col.id, title)} />
                    )}
                  </div>
                )
              })}
            </div>

            <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
              {activeTask && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-2xl p-3 w-[272px] rotate-1 opacity-95">
                  <p className="text-sm font-medium text-gray-900">{activeTask.title}</p>
                  {activeTask.points > 0 && (
                    <span className="flex items-center gap-0.5 text-xs font-bold text-amber-500 mt-1">
                      <Zap className="w-3 h-3" />{activeTask.points} {t('user_pts')}
                    </span>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </TabsContent>

        {/* Achievements Tab */}
        <TabsContent value="achievements" className="flex-1 overflow-auto p-8">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />{t('achievements_title')}
            </h2>
            {canManage && (
              <Dialog open={addAchievementOpen} onOpenChange={(v) => { setAddAchievementOpen(v); if (!v) { setAchieveTitle(''); setAchieveDesc(''); setAchieveDate('') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />{t('achievement_new')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('achievement_new')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddAchievement} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('title')}</Label>
                      <Input value={achieveTitle} onChange={e => setAchieveTitle(e.target.value)} placeholder={t('achievement_title_ph')} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('description')}</Label>
                      <Textarea value={achieveDesc} onChange={e => setAchieveDesc(e.target.value)} rows={2} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('achievement_date')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
                      <Input type="date" value={achieveDate} onChange={e => setAchieveDate(e.target.value)} />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="space-y-3 max-w-2xl">
            {achievements.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {achievements.map(a => (
              <div key={a.id} className="flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Trophy className="w-4 h-4 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-gray-900">{a.title}</p>
                  {a.description && <p className="text-xs text-gray-500 mt-0.5">{a.description}</p>}
                  {a.achievement_date && (
                    <p className="text-xs text-amber-600 font-medium mt-1" suppressHydrationWarning>
                      {new Date(a.achievement_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
                {canManage && (
                  <button type="button" onClick={() => handleDeleteAchievement(a.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Evaluation Tab */}
        <TabsContent value="evaluation" className="flex-1 overflow-auto p-8">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" />{t('evaluation_title')}
            </h2>
            {profile.role === 'super_admin' && (
              <Dialog open={addCriteriaOpen} onOpenChange={(v) => { setAddCriteriaOpen(v); if (!v) { setCriteriaText(''); setCriteriaType('excellent') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />{t('evaluation_new')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('evaluation_new')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddCriteria} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('type_label')}</Label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setCriteriaType('excellent')}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${criteriaType === 'excellent' ? 'bg-green-50 border-green-200 text-green-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                          {t('evaluation_excellent')}
                        </button>
                        <button type="button" onClick={() => setCriteriaType('poor')}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${criteriaType === 'poor' ? 'bg-red-50 border-red-200 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                          {t('evaluation_poor')}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('criteria_label')}</Label>
                      <Textarea value={criteriaText} onChange={e => setCriteriaText(e.target.value)} placeholder={t('criteria_ph')} rows={3} required />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl">
            {/* Excellent column */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 bg-green-500">
                <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <h3 className="text-sm font-semibold text-white">{t('evaluation_excellent_title')}</h3>
                <span className="ml-auto text-xs font-bold bg-white/20 text-white rounded-full px-2 py-0.5">{excellentCriteria.length}</span>
              </div>
              <div className="p-3 space-y-2 min-h-[80px]">
                {excellentCriteria.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">{t('no_data')}</p>
                )}
                {excellentCriteria.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl border border-gray-100 group">
                    <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    </span>
                    <p className="text-sm text-gray-800 flex-1 leading-relaxed">{c.criteria}</p>
                    {profile.role === 'super_admin' && (
                      <button type="button" onClick={() => handleDeleteCriteria(c.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Poor column */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 bg-red-500">
                <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                <h3 className="text-sm font-semibold text-white">{t('evaluation_poor_title')}</h3>
                <span className="ml-auto text-xs font-bold bg-white/20 text-white rounded-full px-2 py-0.5">{poorCriteria.length}</span>
              </div>
              <div className="p-3 space-y-2 min-h-[80px]">
                {poorCriteria.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">{t('no_data')}</p>
                )}
                {poorCriteria.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5 p-3 bg-gray-50 rounded-xl border border-gray-100 group">
                    <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    </span>
                    <p className="text-sm text-gray-800 flex-1 leading-relaxed">{c.criteria}</p>
                    {profile.role === 'super_admin' && (
                      <button type="button" onClick={() => handleDeleteCriteria(c.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Checklist Tab */}
        <TabsContent value="checklist" className="flex-1 overflow-auto p-8">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-blue-500" />{t('checklist_title')}
              </h2>
              {checklist.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {t('checklist_progress')}: {checklist.filter(i => i.completed).length}/{checklist.length}
                </p>
              )}
            </div>
            {profile.role === 'super_admin' && (
              <button
                onClick={() => { setEditChecklistItem(null); setClTitle(''); setClDesc(''); setChecklistOpen(true) }}
                className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Plus className="w-4 h-4" />{t('checklist_add')}
              </button>
            )}
          </div>

          {/* Progress bar */}
          {checklist.length > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-1.5 mb-6">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(checklist.filter(i => i.completed).length / checklist.length) * 100}%` }}
              />
            </div>
          )}

          {checklist.length === 0 ? (
            <div className="text-center py-16">
              <CheckSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">{t('checklist_empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checklist.map(item => (
                <div key={item.id} className={`flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm group transition-opacity ${item.completed ? 'opacity-60' : ''}`}>
                  <button
                    onClick={() => handleChecklistToggle(item)}
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${item.completed ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400'}`}
                  >
                    {item.completed && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${item.completed ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.title}</p>
                    {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                  </div>
                  {profile.role === 'super_admin' && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditChecklistItem(item); setClTitle(item.title); setClDesc(item.description ?? ''); setChecklistOpen(true) }}
                        className="p-1.5 rounded-md hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleChecklistDelete(item)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

      </Tabs>

      {/* Checklist Add/Edit Dialog */}
      <Dialog open={checklistOpen} onOpenChange={(v) => { setChecklistOpen(v); if (!v) { setEditChecklistItem(null); setClTitle(''); setClDesc('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editChecklistItem ? t('checklist_edit') : t('checklist_new')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChecklistSave} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('checklist_item_title')}</Label>
              <Input value={clTitle} onChange={e => setClTitle(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t('checklist_item_desc')}</Label>
              <Textarea value={clDesc} onChange={e => setClDesc(e.target.value)} rows={3} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog */}
      <Dialog open={addTaskOpen} onOpenChange={setAddTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('task_new')}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {COLUMNS.map(col => (
              <button
                key={col.id}
                type="button"
                onClick={() => setAddToColumn(col.id)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition-colors border ${
                  addToColumn === col.id
                    ? col.color + ' border-current'
                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${col.dot}`} />
                {col.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleAddTask} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('task_title')}</Label>
              <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={t('task_title')} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')}</Label>
              <Textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} placeholder="Optional details..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('task_assign')}</Label>
                <select
                  value={taskAssignee}
                  onChange={e => setTaskAssignee(e.target.value)}
                  className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                >
                  <option value="">{t('task_unassigned')}</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Unknown'}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('points')}</Label>
                <Input type="number" value={taskPoints} onChange={e => setTaskPoints(e.target.value)} min="0" />
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Columns Dialog */}
      <Dialog open={manageColsOpen} onOpenChange={setManageColsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('col_manage')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-64 overflow-y-auto">
            {projectColumns.map((col, i) => (
              <div key={col.id} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${COLOR_PALETTE[i % COLOR_PALETTE.length].dot}`} />
                {editingColId === col.id ? (
                  <input
                    autoFocus
                    value={editingColName}
                    onChange={e => setEditingColName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRenameColumn(col.id)
                      if (e.key === 'Escape') setEditingColId(null)
                    }}
                    className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                ) : (
                  <span className="flex-1 text-sm text-gray-800">{col.name}</span>
                )}
                <div className="flex items-center gap-1">
                  {editingColId === col.id ? (
                    <>
                      <button onClick={() => handleRenameColumn(col.id)} className="px-2 py-0.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-700 transition-colors">{t('save')}</button>
                      <button onClick={() => setEditingColId(null)} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded hover:bg-gray-200 transition-colors">{t('cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingColId(col.id); setEditingColName(col.name) }} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteColumn(col.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
            <input
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
              placeholder={t('col_name_ph')}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900/20"
            />
            <button
              onClick={handleAddColumn}
              disabled={!newColName.trim()}
              className="flex items-center gap-1 px-3 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('col_add')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={!!editTask} onOpenChange={open => !open && setEditTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('edit')}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditTask} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('task_title')}</Label>
              <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder={t('task_title')} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')}</Label>
              <Textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} rows={3} placeholder="Optional details..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('task_assign')}</Label>
                <select
                  value={taskAssignee}
                  onChange={e => setTaskAssignee(e.target.value)}
                  className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                >
                  <option value="">{t('task_unassigned')}</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Unknown'}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('points')}</Label>
                <Input type="number" value={taskPoints} onChange={e => setTaskPoints(e.target.value)} min="0" />
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
