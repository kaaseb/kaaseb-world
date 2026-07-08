'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  Plus, Users, Briefcase, Link2, FolderKanban, Trophy, Target,
  BarChart3, Trash2, Edit, ExternalLink, ArrowLeft,
  Loader2, Check, UserPlus, X, Compass, RefreshCw, Zap,
  FileArchive, FileText, FileSpreadsheet, Upload, Download, CreditCard, CheckSquare,
  Palette,
} from 'lucide-react'
import { PaymentsTab } from './PaymentsTab'
import { DoodlesTab } from './DoodlesTab'
import { useRouter } from 'next/navigation'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface Member {
  id: string
  user_id: string
  department_member_job_descriptions: { job_description_id: string; job_descriptions: { id: string; role_name: string } }[]
  profiles: {
    id: string
    full_name: string | null
    email: string
    avatar_url: string | null
    role: string
    total_points: number
  }
}

interface JobDesc {
  id: string
  role_name: string
  responsibilities: string[]
  created_at: string
}

interface ILink {
  id: string
  title: string
  url: string
  description: string | null
}

interface Project {
  id: string
  name: string
  description: string | null
  status: string
  tasks: { count: number }[]
}

interface Achievement {
  id: string
  title: string
  description: string | null
  achievement_date: string | null
  created_at: string
}

interface GoalStep {
  id: string
  title: string
  completed: boolean
  position: number
}

interface Goal {
  id: string
  title: string
  description: string | null
  completed: boolean
  goal_steps: GoalStep[]
}

interface EvalCriteria {
  id: string
  type: 'excellent' | 'poor'
  criteria: string
}

interface DeptFile {
  id: string
  name: string
  file_path: string
  file_size: number | null
  file_type: string
  created_at: string
}

interface DeptChecklistItem {
  id: string
  title: string
  description: string | null
  completed: boolean
  position: number
}

interface RecurringTask {
  id: string
  name: string
  description: string | null
  points: number
  task_type: 'recurring' | 'one_time'
  assigned_position: string | null
  assigned_user_id: string | null
  created_at: string
}

interface RecurringCompletion {
  id: string
  task_id: string
  user_id: string
  completed_date: string
}

interface Department {
  id: string
  name: string
  description: string | null
  vision: string | null
  mission: string | null
}

interface DepartmentDetailClientProps {
  department: Department
  members: Member[]
  jobDescriptions: JobDesc[]
  links: ILink[]
  projects: Project[]
  achievements: Achievement[]
  goals: Goal[]
  evaluationCriteria: EvalCriteria[]
  allUsers: Partial<Profile>[]
  recurringTasks: RecurringTask[]
  files: DeptFile[]
  checklist: DeptChecklistItem[]
  profile: Profile
  isSuperAdmin: boolean
  canManage: boolean
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const FILES_BUCKET = 'department-files'

function getFileIcon(type: string) {
  if (type === 'pdf') return <FileText className="w-5 h-5 text-red-500" />
  if (type === 'zip') return <FileArchive className="w-5 h-5 text-yellow-500" />
  if (type === 'xlsx') return <FileSpreadsheet className="w-5 h-5 text-green-600" />
  if (type === 'csv') return <FileSpreadsheet className="w-5 h-5 text-teal-500" />
  return <FileText className="w-5 h-5 text-gray-400" />
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DepartmentDetailClient({
  department,
  members: initMembers,
  jobDescriptions: initJobs,
  links: initLinks,
  projects: initProjects,
  achievements: initAchievements,
  goals: initGoals,
  evaluationCriteria: initCriteria,
  recurringTasks: initRecurringTasks,
  files: initFiles,
  checklist: initChecklist,
  allUsers,
  profile,
  isSuperAdmin,
  canManage,
}: DepartmentDetailClientProps) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const supabase = createClient()

  // Tab state (controlled to prevent accidental resets)
  const [activeTab, setActiveTab] = useState<string>('members')
  // Ref for the horizontally-scrolling tab strip — set RTL initial scroll only once.
  const tabStripRef = useRef<HTMLDivElement>(null)
  const tabStripInitialised = useRef(false)
  useEffect(() => {
    if (tabStripInitialised.current) return
    if (tabStripRef.current && isRtl) {
      tabStripRef.current.scrollLeft = tabStripRef.current.scrollWidth
    }
    tabStripInitialised.current = true
  }, [isRtl])

  // State
  const [members, setMembers] = useState(initMembers)
  const [jobs, setJobs] = useState(initJobs)
  const [links, setLinks] = useState(initLinks)
  const [projects, setProjects] = useState(initProjects)
  const [achievements, setAchievements] = useState(initAchievements)
  const [goals, setGoals] = useState(initGoals)
  const [criteria, setCriteria] = useState(initCriteria)
  const [vision, setVision] = useState(department.vision ?? '')
  const [mission, setMission] = useState(department.mission ?? '')
  const [editingVision, setEditingVision] = useState(false)
  const [editingMission, setEditingMission] = useState(false)
  const [savingVision, setSavingVision] = useState(false)
  const [savingMission, setSavingMission] = useState(false)

  // Files state
  const [deptFiles, setDeptFiles] = useState<DeptFile[]>(initFiles)
  const [uploadingFile, setUploadingFile] = useState(false)

  // Checklist state
  const [checklist, setChecklist] = useState<DeptChecklistItem[]>(initChecklist)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [editChecklistItem, setEditChecklistItem] = useState<DeptChecklistItem | null>(null)
  const [clTitle, setClTitle] = useState('')
  const [clDesc, setClDesc] = useState('')

  // Recurring tasks state
  const [recurringTasks, setRecurringTasks] = useState<RecurringTask[]>(initRecurringTasks)
  const [completions, setCompletions] = useState<RecurringCompletion[]>([])
  const [addRecurringOpen, setAddRecurringOpen] = useState(false)
  const [editRecurring, setEditRecurring] = useState<RecurringTask | null>(null)
  const [recurringName, setRecurringName] = useState('')
  const [recurringDesc, setRecurringDesc] = useState('')
  const [recurringPoints, setRecurringPoints] = useState('0')
  const [recurringTaskType, setRecurringTaskType] = useState<'recurring' | 'one_time'>('recurring')
  const [addTaskType, setAddTaskType] = useState<'recurring' | 'one_time'>('recurring')
  const [recurringPosition, setRecurringPosition] = useState('')
  const [assignedUserId, setAssignedUserId] = useState('')
  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    async function loadCompletions() {
      const { data } = await supabase
        .from('department_recurring_completions')
        .select('*')
        .eq('completed_date', today)
        .in('task_id', recurringTasks.map(t => t.id))
      if (data) setCompletions(data)
    }
    if (recurringTasks.length > 0) loadCompletions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  // Dialog states
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addJobOpen, setAddJobOpen] = useState(false)
  const [editJob, setEditJob] = useState<JobDesc | null>(null)
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [addAchievementOpen, setAddAchievementOpen] = useState(false)
  const [addGoalOpen, setAddGoalOpen] = useState(false)
  const [addCriteriaOpen, setAddCriteriaOpen] = useState(false)

  // Edit member state
  const [editMember, setEditMember] = useState<Member | null>(null)
  const [editMemberRole, setEditMemberRole] = useState('')
  const [editMemberJobDescIds, setEditMemberJobDescIds] = useState<string[]>([])
  const [savingEditMember, setSavingEditMember] = useState(false)

  // Form states
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedJobDescIds, setSelectedJobDescIds] = useState<string[]>([])
  const [jobRoleName, setJobRoleName] = useState('')
  const [jobResponsibilities, setJobResponsibilities] = useState('')
  const [jobAssignedMemberIds, setJobAssignedMemberIds] = useState<string[]>([])
  const [assignJobId, setAssignJobId] = useState<string | null>(null)
  const [savingJobAssign, setSavingJobAssign] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkDesc, setLinkDesc] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectDesc, setProjectDesc] = useState('')
  const [achieveTitle, setAchieveTitle] = useState('')
  const [achieveDesc, setAchieveDesc] = useState('')
  const [achieveDate, setAchieveDate] = useState('')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDesc, setGoalDesc] = useState('')
  const [goalSteps, setGoalSteps] = useState([''])
  const [criteriaType, setCriteriaType] = useState<'excellent' | 'poor'>('excellent')
  const [criteriaText, setCriteriaText] = useState('')
  const [loading, setLoading] = useState(false)

  const nonMembers = allUsers.filter(u => !members.some(m => m.user_id === u.id))

  // Add Member
  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUserId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('department_members')
      .insert({ department_id: department.id, user_id: selectedUserId })
      .select('*, profiles(id, full_name, email, avatar_url, role, total_points)')
      .single()
    if (error) { toast.error('Failed to add member'); setLoading(false); return }
    // Insert junction rows for job descriptions
    if (selectedJobDescIds.length > 0) {
      await supabase.from('department_member_job_descriptions').insert(
        selectedJobDescIds.map(jid => ({ member_id: data.id, job_description_id: jid }))
      )
    }
    const memberWithJobs = {
      ...data,
      department_member_job_descriptions: selectedJobDescIds.map(jid => ({
        job_description_id: jid,
        job_descriptions: jobs.find(j => j.id === jid) ? { id: jid, role_name: jobs.find(j => j.id === jid)!.role_name } : { id: jid, role_name: '' },
      })),
    }
    setMembers(prev => [...prev, memberWithJobs])
    setAddMemberOpen(false); setSelectedUserId(''); setSelectedJobDescIds([])
    toast.success('Member added!')
    setLoading(false)
  }

  // Edit Member
  async function handleSaveEditMember() {
    if (!editMember) return
    setSavingEditMember(true)
    // Update profile role
    const profileRes = await supabase.from('profiles').update({ role: editMemberRole }).eq('id', editMember.user_id)
    // Replace junction rows: delete old, insert new
    await supabase.from('department_member_job_descriptions').delete().eq('member_id', editMember.id)
    if (editMemberJobDescIds.length > 0) {
      await supabase.from('department_member_job_descriptions').insert(
        editMemberJobDescIds.map(jid => ({ member_id: editMember.id, job_description_id: jid }))
      )
    }
    setSavingEditMember(false)
    if (profileRes.error) { toast.error('حدث خطأ'); return }
    setMembers(prev => prev.map(m => m.id === editMember.id
      ? {
          ...m,
          profiles: { ...m.profiles, role: editMemberRole },
          department_member_job_descriptions: editMemberJobDescIds.map(jid => ({
            job_description_id: jid,
            job_descriptions: { id: jid, role_name: jobs.find(j => j.id === jid)?.role_name ?? '' },
          })),
        }
      : m
    ))
    setEditMember(null)
    toast.success('تم التعديل')
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Remove this member?')) return
    const { error } = await supabase.from('department_members').delete().eq('id', memberId)
    if (error) { toast.error('Failed to remove member') }
    else { setMembers(members.filter(m => m.id !== memberId)); toast.success('Member removed') }
  }

  // Job Descriptions
  async function handleAddJob(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const resps = [jobResponsibilities.trim()].filter(Boolean)
    const { data, error } = await supabase
      .from('job_descriptions')
      .insert({ department_id: department.id, role_name: jobRoleName, responsibilities: resps, created_by: profile.id })
      .select()
      .single()
    if (error) { toast.error('Failed to add job description') }
    else { setJobs([...jobs, data]); setAddJobOpen(false); setJobRoleName(''); setJobResponsibilities(''); toast.success('Job description added!') }
    setLoading(false)
  }

  async function handleUpdateJob(e: React.FormEvent) {
    e.preventDefault()
    if (!editJob) return
    setLoading(true)
    const resps = [jobResponsibilities.trim()].filter(Boolean)
    const { data, error } = await supabase
      .from('job_descriptions')
      .update({ role_name: jobRoleName, responsibilities: resps })
      .eq('id', editJob.id)
      .select()
      .single()
    if (error) { toast.error('Failed to update') }
    else { setJobs(jobs.map(j => j.id === editJob.id ? data : j)); setEditJob(null); toast.success('Updated!') }
    setLoading(false)
  }

  async function handleDeleteJob(id: string) {
    if (!confirm('Delete this job description?')) return
    await supabase.from('job_descriptions').delete().eq('id', id)
    setJobs(jobs.filter(j => j.id !== id))
    toast.success('Deleted')
  }

  function getMembersForJob(jobId: string) {
    return members.filter(m => m.department_member_job_descriptions?.some(jd => jd.job_description_id === jobId))
  }

  function openJobAssign(jobId: string) {
    const currentMemberIds = getMembersForJob(jobId).map(m => m.id)
    setAssignJobId(jobId)
    setJobAssignedMemberIds(currentMemberIds)
  }

  async function handleSaveJobAssign() {
    if (!assignJobId) return
    setSavingJobAssign(true)

    // Get current members assigned to this job
    const currentMembers = getMembersForJob(assignJobId)
    const currentIds = currentMembers.map(m => m.id)
    const toAdd = jobAssignedMemberIds.filter(id => !currentIds.includes(id))
    const toRemove = currentIds.filter(id => !jobAssignedMemberIds.includes(id))

    // Insert new assignments
    if (toAdd.length > 0) {
      await supabase.from('department_member_job_descriptions').insert(
        toAdd.map(memberId => ({ member_id: memberId, job_description_id: assignJobId }))
      )
    }

    // Remove unassigned
    for (const memberId of toRemove) {
      await supabase.from('department_member_job_descriptions')
        .delete()
        .eq('member_id', memberId)
        .eq('job_description_id', assignJobId)
    }

    // Update local state
    const job = jobs.find(j => j.id === assignJobId)
    setMembers(prev => prev.map(m => {
      const wasAssigned = currentIds.includes(m.id)
      const isNowAssigned = jobAssignedMemberIds.includes(m.id)
      if (wasAssigned && !isNowAssigned) {
        return { ...m, department_member_job_descriptions: m.department_member_job_descriptions.filter(jd => jd.job_description_id !== assignJobId) }
      }
      if (!wasAssigned && isNowAssigned && job) {
        return { ...m, department_member_job_descriptions: [...m.department_member_job_descriptions, { job_description_id: assignJobId, job_descriptions: { id: assignJobId, role_name: job.role_name } }] }
      }
      return m
    }))

    setAssignJobId(null)
    setSavingJobAssign(false)
    toast.success(t('save'))
  }

  // Links
  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('important_links')
      .insert({ department_id: department.id, title: linkTitle, url: linkUrl, description: linkDesc || null, created_by: profile.id })
      .select()
      .single()
    if (error) { toast.error('Failed to add link') }
    else { setLinks([...links, data]); setAddLinkOpen(false); setLinkTitle(''); setLinkUrl(''); setLinkDesc(''); toast.success('Link added!') }
    setLoading(false)
  }

  async function handleDeleteLink(id: string) {
    await supabase.from('important_links').delete().eq('id', id)
    setLinks(links.filter(l => l.id !== id))
    toast.success('Link deleted')
  }

  // Projects
  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: projectName, description: projectDesc || null, department_id: department.id, created_by: profile.id, status: 'active' })
      .select('*, tasks(count)')
      .single()
    if (error) { toast.error('Failed to create project') }
    else { setProjects([data, ...projects]); setAddProjectOpen(false); setProjectName(''); setProjectDesc(''); toast.success('Project created!') }
    setLoading(false)
  }

  async function handleDeleteProject(id: string) {
    if (!confirm(t('delete') + '?')) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { toast.error('Failed to delete project'); return }
    setProjects(projects.filter(p => p.id !== id))
    toast.success(t('delete'))
  }

  // Achievements
  async function handleAddAchievement(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('achievements')
      .insert({ department_id: department.id, title: achieveTitle, description: achieveDesc || null, achievement_date: achieveDate || null, created_by: profile.id })
      .select()
      .single()
    if (error) { toast.error('Failed to add achievement') }
    else { setAchievements([data, ...achievements]); setAddAchievementOpen(false); setAchieveTitle(''); setAchieveDesc(''); setAchieveDate(''); toast.success('Achievement added!') }
    setLoading(false)
  }

  async function handleDeleteAchievement(id: string) {
    await supabase.from('achievements').delete().eq('id', id)
    setAchievements(achievements.filter(a => a.id !== id))
    toast.success('Deleted')
  }

  // Goals
  async function handleAddGoal(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data: goal, error } = await supabase
      .from('goals')
      .insert({ title: goalTitle, description: goalDesc || null, department_id: department.id, is_global: false, created_by: profile.id })
      .select()
      .single()
    if (error) { toast.error('Failed to add goal'); setLoading(false); return }

    const validSteps = goalSteps.filter(s => s.trim())
    if (validSteps.length > 0) {
      await supabase.from('goal_steps').insert(validSteps.map((s, i) => ({ goal_id: goal.id, title: s, position: i })))
    }

    const { data: full } = await supabase.from('goals').select('*, goal_steps(*)').eq('id', goal.id).single()
    if (full) setGoals([full, ...goals])
    setAddGoalOpen(false); setGoalTitle(''); setGoalDesc(''); setGoalSteps([''])
    toast.success('Goal added!')
    setLoading(false)
  }

  async function handleDeleteGoal(id: string) {
    await supabase.from('goals').delete().eq('id', id)
    setGoals(goals.filter(g => g.id !== id))
    toast.success('Deleted')
  }

  async function handleToggleStep(goalId: string, stepId: string, completed: boolean) {
    await supabase.from('goal_steps').update({ completed: !completed }).eq('id', stepId)
    setGoals(goals.map(g => g.id === goalId ? {
      ...g, goal_steps: g.goal_steps.map(s => s.id === stepId ? { ...s, completed: !completed } : s)
    } : g))
  }

  // Evaluation Criteria
  async function handleAddCriteria(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await supabase
      .from('evaluation_criteria')
      .insert({ department_id: department.id, type: criteriaType, criteria: criteriaText, created_by: profile.id })
      .select()
      .single()
    if (error) { toast.error('Failed to add criteria') }
    else { setCriteria([...criteria, data]); setAddCriteriaOpen(false); setCriteriaText(''); toast.success('Criteria added!') }
    setLoading(false)
  }

  async function handleDeleteCriteria(id: string) {
    await supabase.from('evaluation_criteria').delete().eq('id', id)
    setCriteria(criteria.filter(c => c.id !== id))
    toast.success(t('delete'))
  }

  // Recurring Task handlers
  async function handleAddRecurringTask(e: React.FormEvent) {
    e.preventDefault()
    if (!recurringName.trim()) return
    setLoading(true)
    const pts = Math.max(0, parseInt(recurringPoints) || 0)
    if (editRecurring) {
      const { data, error } = await supabase
        .from('department_recurring_tasks')
        .update({ name: recurringName.trim(), description: recurringDesc.trim() || null, points: pts, assigned_position: recurringPosition.trim() || null, assigned_user_id: assignedUserId || null })
        .eq('id', editRecurring.id)
        .select()
        .single()
      if (error) { toast.error('Failed to update task') }
      else {
        setRecurringTasks(recurringTasks.map(t => t.id === editRecurring.id ? data : t))
        setAddRecurringOpen(false)
        setEditRecurring(null)
        setRecurringName('')
        setRecurringDesc('')
        setRecurringPoints('0')
        setRecurringPosition('')
        setAssignedUserId('')
        toast.success(t('dept_recurring_saved'))
      }
    } else {
      const { data, error } = await supabase
        .from('department_recurring_tasks')
        .insert({ department_id: department.id, name: recurringName.trim(), description: recurringDesc.trim() || null, points: pts, task_type: addTaskType, assigned_position: recurringPosition.trim() || null, assigned_user_id: assignedUserId || null, created_by: profile.id })
        .select()
        .single()
      if (error) { toast.error('Failed to add task') }
      else {
        setRecurringTasks([...recurringTasks, data])
        setRecurringTaskType(addTaskType)
        setAddRecurringOpen(false)
        // Notify assignee by email (only when an individual was picked).
        if (assignedUserId && data?.id) {
          fetch('/api/email/task-assigned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'department', taskId: data.id, assigneeId: assignedUserId }),
          }).catch(() => {})
        }
        setRecurringName('')
        setRecurringDesc('')
        setRecurringPoints('0')
        setRecurringPosition('')
        setAssignedUserId('')
        setAddTaskType('recurring')
        toast.success(t('dept_recurring_saved'))
      }
    }
    setLoading(false)
  }

  async function handleDeleteRecurringTask(id: string) {
    if (!confirm(t('confirm'))) return
    const { error } = await supabase.from('department_recurring_tasks').delete().eq('id', id)
    if (error) { toast.error('Failed to delete task') }
    else {
      setRecurringTasks(recurringTasks.filter(t => t.id !== id))
      setCompletions(completions.filter(c => c.task_id !== id))
      toast.success(t('dept_recurring_deleted'))
    }
  }

  async function handleToggleRecurring(taskId: string) {
    const task = recurringTasks.find(t => t.id === taskId)
    if (!task) return

    // One-time tasks: mark done = delete permanently
    if (task.task_type === 'one_time') {
      const { error } = await supabase.from('department_recurring_tasks').delete().eq('id', taskId)
      if (!error) {
        setRecurringTasks(recurringTasks.filter(t => t.id !== taskId))
        if (task.points > 0) {
          const { data: profileData } = await supabase.from('profiles').select('total_points').eq('id', profile.id).single()
          if (profileData) {
            await supabase.from('profiles').update({ total_points: (profileData.total_points ?? 0) + task.points }).eq('id', profile.id)
            toast.success(`+${task.points} ${t('user_pts')}!`)
          }
        } else {
          toast.success(t('dept_recurring_saved'))
        }
      }
      return
    }

    // Recurring tasks: toggle completion for today
    const existing = completions.find(c => c.task_id === taskId)
    if (existing) {
      const { error } = await supabase.from('department_recurring_completions').delete().eq('id', existing.id)
      if (!error) {
        setCompletions(completions.filter(c => c.id !== existing.id))
        if (task.points > 0) {
          const { data: profileData } = await supabase.from('profiles').select('total_points').eq('id', profile.id).single()
          if (profileData) {
            await supabase.from('profiles').update({ total_points: Math.max(0, (profileData.total_points ?? 0) - task.points) }).eq('id', profile.id)
          }
        }
      }
    } else {
      const { data, error } = await supabase
        .from('department_recurring_completions')
        .insert({ task_id: taskId, user_id: profile.id, completed_date: today })
        .select()
        .single()
      if (!error && data) {
        setCompletions([...completions, data])
        if (task.points > 0) {
          const { data: profileData } = await supabase.from('profiles').select('total_points').eq('id', profile.id).single()
          if (profileData) {
            await supabase.from('profiles').update({ total_points: (profileData.total_points ?? 0) + task.points }).eq('id', profile.id)
            toast.success(`+${task.points} ${t('user_pts')}!`)
          }
        }
      }
    }
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingFile(true)
    const form = new FormData()
    form.append('file', file)
    form.append('department_id', department.id)
    const res = await fetch('/api/department-files', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Upload failed') }
    else { setDeptFiles([data, ...deptFiles]); toast.success(t('dept_files_uploaded')) }
    setUploadingFile(false)
  }

  async function handleDeleteFile(file: DeptFile) {
    const res = await fetch('/api/department-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: file.id, file_path: file.file_path, name: file.name }),
    })
    if (!res.ok) { toast.error('Failed to delete'); return }
    setDeptFiles(deptFiles.filter(f => f.id !== file.id))
    toast.success(t('dept_files_deleted'))
  }

  function getFilePublicUrl(path: string) {
    return `${SUPABASE_URL}/storage/v1/object/public/${FILES_BUCKET}/${path}`
  }

  async function handleSaveVision() {
    setSavingVision(true)
    await supabase.from('departments').update({ vision }).eq('id', department.id)
    setSavingVision(false)
    setEditingVision(false)
    toast.success(t('dept_vision_saved'))
  }

  async function handleSaveMission() {
    setSavingMission(true)
    await supabase.from('departments').update({ mission }).eq('id', department.id)
    setSavingMission(false)
    setEditingMission(false)
    toast.success(t('dept_mission_saved'))
  }

  const excellentCriteria = criteria.filter(c => c.type === 'excellent')
  const poorCriteria = criteria.filter(c => c.type === 'poor')

  // Checklist handlers
  async function handleSaveChecklist(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    if (editChecklistItem) {
      const { data, error } = await supabase
        .from('department_checklist')
        .update({ title: clTitle.trim(), description: clDesc.trim() || null })
        .eq('id', editChecklistItem.id)
        .select()
        .single()
      if (error) { toast.error('Failed to update'); setLoading(false); return }
      setChecklist(checklist.map(i => i.id === editChecklistItem.id ? data : i))
      toast.success(t('dept_checklist_edit'))
    } else {
      const { data, error } = await supabase
        .from('department_checklist')
        .insert({ department_id: department.id, title: clTitle.trim(), description: clDesc.trim() || null, completed: false, position: checklist.length })
        .select()
        .single()
      if (error) { toast.error('Failed to add'); setLoading(false); return }
      setChecklist([...checklist, data])
      toast.success(t('dept_checklist_add'))
    }
    setChecklistOpen(false)
    setEditChecklistItem(null)
    setClTitle('')
    setClDesc('')
    setLoading(false)
  }

  async function handleDeleteChecklistItem(item: DeptChecklistItem) {
    if (!confirm(t('delete') + '?')) return
    await supabase.from('department_checklist').delete().eq('id', item.id)
    setChecklist(checklist.filter(i => i.id !== item.id))
    toast.success(t('delete'))
  }

  async function handleToggleChecklist(item: DeptChecklistItem) {
    const { error } = await supabase
      .from('department_checklist')
      .update({ completed: !item.completed })
      .eq('id', item.id)
    if (!error) setChecklist(checklist.map(i => i.id === item.id ? { ...i, completed: !item.completed } : i))
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className={`flex items-center gap-3 mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <button
          onClick={() => router.push('/departments')}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{department.name}</h1>
          {department.description && <p className="text-gray-500 mt-0.5 text-sm">{department.description}</p>}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Tab Navigation */}
        <div ref={tabStripRef} className="mb-6 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
          <div className="inline-flex gap-2 min-w-max">
            {([
              { value: 'members', icon: Users, label: t('department_members'), adminOnly: false },
              { value: 'jobs', icon: Briefcase, label: t('department_jobs'), adminOnly: false },
              { value: 'links', icon: Link2, label: t('department_links'), adminOnly: false },
              { value: 'projects', icon: FolderKanban, label: t('department_projects'), adminOnly: false },
              { value: 'achievements', icon: Trophy, label: t('department_achievements'), adminOnly: false },
              { value: 'doodles', icon: Palette, label: t('dept_doodles'), adminOnly: false },
              { value: 'evaluation', icon: BarChart3, label: t('department_evaluation'), adminOnly: false },
              { value: 'vision_mission', icon: Compass, label: t('dept_vision_mission'), adminOnly: false },
              { value: 'files', icon: FileArchive, label: t('dept_files'), adminOnly: false },
              { value: 'checklist', icon: CheckSquare, label: t('dept_checklist'), adminOnly: false },
              { value: 'payments', icon: CreditCard, label: 'المدفوعات', adminOnly: true },
            ] as const).filter(tab => !tab.adminOnly || isSuperAdmin).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setActiveTab(value)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === value
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <TabsList className="hidden"></TabsList>

        {/* MEMBERS TAB */}
        <TabsContent value="members">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_members')} ({members.length})</h2>
            {canManage && (
              <Dialog open={addMemberOpen} onOpenChange={v => { setAddMemberOpen(v); if (!v) { setSelectedUserId(''); setSelectedJobDescIds([]) } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <UserPlus className="w-4 h-4" />
                  {t('add_member')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('add_member')} — {department.name}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddMember} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('select_user')}</Label>
                      <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        required
                        className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                      >
                        <option value="">{t('select_user')}...</option>
                        {nonMembers.map(u => (
                          <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.role?.replace('_', ' ')})</option>
                        ))}
                      </select>
                    </div>
                    {jobs.length > 0 && (
                      <div className="space-y-2">
                        <Label>المسميات الوظيفية (اختياري — يمكن أكثر من واحد)</Label>
                        <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-36 overflow-y-auto">
                          {jobs.map(j => (
                            <label key={j.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                checked={selectedJobDescIds.includes(j.id)}
                                onChange={e => setSelectedJobDescIds(prev => e.target.checked ? [...prev, j.id] : prev.filter(id => id !== j.id))}
                                className="accent-gray-900"
                              />
                              {j.role_name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedUserId && (
                      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        {nonMembers.find(u => u.id === selectedUserId)?.full_name || nonMembers.find(u => u.id === selectedUserId)?.email}
                        {' → '}
                        {nonMembers.find(u => u.id === selectedUserId)?.role?.replace('_', ' ')}
                        {selectedJobDescIds.length > 0 && ` → ${selectedJobDescIds.map(id => jobs.find(j => j.id === id)?.role_name).join(', ')}`}
                      </p>
                    )}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add_member')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          {/* Edit Member Dialog */}
          {editMember && (
            <Dialog open={!!editMember} onOpenChange={v => { if (!v) setEditMember(null) }}>
              <DialogContent>
                <DialogHeader><DialogTitle>تعديل العضو — {editMember.profiles?.full_name || editMember.profiles?.email}</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label>الصلاحية</Label>
                    <select
                      value={editMemberRole}
                      onChange={e => setEditMemberRole(e.target.value)}
                      className="w-full h-9 rounded-lg border border-gray-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                    >
                      <option value="employee">Employee</option>
                      <option value="project_manager">Project Manager</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </div>
                  {jobs.length > 0 && (
                    <div className="space-y-2">
                      <Label>المسميات الوظيفية (يمكن أكثر من واحد)</Label>
                      <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-36 overflow-y-auto">
                        {jobs.map(j => (
                          <label key={j.id} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={editMemberJobDescIds.includes(j.id)}
                              onChange={e => setEditMemberJobDescIds(prev => e.target.checked ? [...prev, j.id] : prev.filter(id => id !== j.id))}
                              className="accent-gray-900"
                            />
                            {j.role_name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    {editMember.profiles?.full_name || editMember.profiles?.email}
                    {' → '}
                    {editMemberRole.replace('_', ' ')}
                    {editMemberJobDescIds.length > 0 && ` → ${editMemberJobDescIds.map(id => jobs.find(j => j.id === id)?.role_name).join(', ')}`}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveEditMember} disabled={savingEditMember} className="flex-1">
                      {savingEditMember ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />جاري...</> : 'حفظ التعديل'}
                    </Button>
                    <Button variant="outline" onClick={() => setEditMember(null)} className="flex-1">إلغاء</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map(m => (
              <Card key={m.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {m.profiles?.avatar_url ? (
                      <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-bold text-gray-600">
                        {(m.profiles?.full_name || m.profiles?.email || 'U')[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{m.profiles?.full_name || 'Unknown'}</p>
                    {m.department_member_job_descriptions?.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.department_member_job_descriptions.map(jd => (
                          <span key={jd.job_description_id} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md font-medium">
                            {jd.job_descriptions?.role_name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 truncate">{m.profiles?.role?.replace('_', ' ')}</p>
                    )}
                    {canManage && <p className="text-xs text-amber-600 font-medium mt-1">{m.profiles?.total_points || 0} {t('user_pts')}</p>}
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditMember(m); setEditMemberRole(m.profiles?.role ?? 'employee'); setEditMemberJobDescIds(m.department_member_job_descriptions?.map(jd => jd.job_description_id) ?? []) }}
                        className="p-1.5 rounded-md hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleRemoveMember(m.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {members.length === 0 && (
              <div className="col-span-3 text-center py-12 text-gray-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* JOB DESCRIPTIONS TAB */}
        <TabsContent value="jobs">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_jobs')}</h2>
            {canManage && (
              <Dialog open={addJobOpen} onOpenChange={(v) => { setAddJobOpen(v); if (!v) { setJobRoleName(''); setJobResponsibilities('') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('add')}
                </DialogTrigger>
                <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>{t('add')} {t('department_jobs')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddJob} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('role')}</Label>
                      <Input value={jobRoleName} onChange={e => setJobRoleName(e.target.value)} placeholder="e.g. Frontend Developer" required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('responsibilities')}</Label>
                      <Textarea value={jobResponsibilities} onChange={e => setJobResponsibilities(e.target.value)} placeholder={t('responsibility_ph')} rows={8} />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="space-y-4">
            {jobs.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Briefcase className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {jobs.map(job => {
              const assignedMembers = getMembersForJob(job.id)
              return (
              <Card key={job.id} className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-blue-500" />
                      {job.role_name}
                    </CardTitle>
                    {canManage && (
                      <div className="flex gap-1">
                        <button onClick={() => openJobAssign(job.id)}
                          className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-500 transition-colors"
                          title={t('add_member')}
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { setEditJob(job); setJobRoleName(job.role_name); setJobResponsibilities((job.responsibilities || []).join('\n')) }}
                          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteJob(job.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap mb-3">{(job.responsibilities || []).join('\n')}</p>
                  {assignedMembers.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('job_responsible')}</p>
                      <div className="flex flex-wrap gap-2">
                        {assignedMembers.map(m => (
                          <span key={m.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 text-xs font-medium text-blue-700">
                            <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {m.profiles?.avatar_url ? (
                                <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[10px] font-bold text-blue-600">
                                  {(m.profiles?.full_name || m.profiles?.email || 'U')[0].toUpperCase()}
                                </span>
                              )}
                            </span>
                            {m.profiles?.full_name || m.profiles?.email}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>

          {/* Edit Job Dialog */}
          <Dialog open={!!editJob} onOpenChange={(open) => !open && setEditJob(null)}>
            <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{t('edit')} {t('department_jobs')}</DialogTitle></DialogHeader>
              <form onSubmit={handleUpdateJob} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>{t('role')}</Label>
                  <Input value={jobRoleName} onChange={e => setJobRoleName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>{t('responsibilities')}</Label>
                  <Textarea value={jobResponsibilities} onChange={e => setJobResponsibilities(e.target.value)} rows={8} />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          {/* Assign Members to Job Dialog */}
          <Dialog open={!!assignJobId} onOpenChange={(open) => { if (!open) setAssignJobId(null) }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('add_member')} — {jobs.find(j => j.id === assignJobId)?.role_name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                {members.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">{t('no_data')}</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-60 overflow-y-auto">
                    {members.map(m => (
                      <label key={m.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={jobAssignedMemberIds.includes(m.id)}
                          onChange={e => setJobAssignedMemberIds(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                          )}
                          className="accent-gray-900"
                        />
                        <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {m.profiles?.avatar_url ? (
                            <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-bold text-gray-600">
                              {(m.profiles?.full_name || m.profiles?.email || 'U')[0].toUpperCase()}
                            </span>
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{m.profiles?.full_name || m.profiles?.email}</p>
                          <p className="text-xs text-gray-400">{m.profiles?.role?.replace('_', ' ')}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                <Button onClick={handleSaveJobAssign} disabled={savingJobAssign} className="w-full">
                  {savingJobAssign ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* IMPORTANT LINKS TAB */}
        <TabsContent value="links">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_links')}</h2>
            {canManage && (
              <Dialog open={addLinkOpen} onOpenChange={(v) => { setAddLinkOpen(v); if (!v) { setLinkTitle(''); setLinkUrl(''); setLinkDesc('') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('add')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('add')} {t('link_label')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddLink} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('title')}</Label>
                      <Input value={linkTitle} onChange={e => setLinkTitle(e.target.value)} placeholder="e.g. Design System" required />
                    </div>
                    <div className="space-y-2">
                      <Label>URL</Label>
                      <Input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('description')} ({t('optional')})</Label>
                      <Input value={linkDesc} onChange={e => setLinkDesc(e.target.value)} placeholder={t('link_desc_ph')} />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {links.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400">
                <Link2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {links.map(link => (
              <Card key={link.id} className="border-0 shadow-sm hover:shadow-md transition-shadow group">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">{link.title}</p>
                    {link.description && <p className="text-xs text-gray-500 mt-0.5">{link.description}</p>}
                    <a href={link.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1 truncate">
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      {link.url}
                    </a>
                  </div>
                  {canManage && (
                    <button onClick={() => handleDeleteLink(link.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* PROJECTS TAB */}
        <TabsContent value="projects">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_projects')} ({projects.length})</h2>
            {canManage && (
              <Dialog open={addProjectOpen} onOpenChange={(v) => { setAddProjectOpen(v); if (!v) { setProjectName(''); setProjectDesc('') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('project_new')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('project_new')} in {department.name}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddProject} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('project_name')}</Label>
                      <Input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder={t('project_name')} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('description')}</Label>
                      <Textarea value={projectDesc} onChange={e => setProjectDesc(e.target.value)} rows={3} placeholder={t('project_desc_ph')} />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('create')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.length === 0 && (
              <div className="col-span-3 text-center py-12 text-gray-400">
                <FolderKanban className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {projects.map(p => (
              <Card key={p.id} className="border-0 shadow-sm hover:shadow-md transition-shadow group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <FolderKanban className="w-4 h-4 text-violet-600" />
                    </div>
                    {canManage && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id) }}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                    <p className="font-semibold text-sm text-gray-900">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>}
                    <div className="flex items-center justify-between mt-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.status === 'active' ? t('project_status_active') : p.status === 'completed' ? t('project_status_completed') : t('project_status_archived')}
                      </span>
                      <span className="text-xs text-gray-400">{p.tasks?.[0]?.count || 0} {t('tasks_count')}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ACHIEVEMENTS TAB */}
        <TabsContent value="achievements">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_achievements')}</h2>
            {canManage && (
              <Dialog open={addAchievementOpen} onOpenChange={(v) => { setAddAchievementOpen(v); if (!v) { setAchieveTitle(''); setAchieveDesc(''); setAchieveDate('') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('achievement_new')}
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
          <div className="space-y-3">
            {achievements.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Trophy className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {achievements.map(a => (
              <Card key={a.id} className="border-0 shadow-sm">
                <CardContent className="p-4 flex items-start gap-3">
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
                    <button onClick={() => handleDeleteAchievement(a.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* DOODLES TAB (شخابيط القسم) */}
        <TabsContent value="doodles">
          <DoodlesTab
            departmentId={department.id}
            currentUserId={profile.id}
            isSuperAdmin={isSuperAdmin}
            members={members.map(m => m.profiles)}
            allUsers={allUsers}
          />
        </TabsContent>

        {/* GOALS TAB (button hidden — accessible only via legacy state) */}
        <TabsContent value="goals">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('department_goals')}</h2>
            {canManage && (
              <Dialog open={addGoalOpen} onOpenChange={(v) => { setAddGoalOpen(v); if (!v) { setGoalTitle(''); setGoalDesc(''); setGoalSteps(['']) } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('goal_new')}
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{t('goal_new')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddGoal} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('title')}</Label>
                      <Input value={goalTitle} onChange={e => setGoalTitle(e.target.value)} placeholder={t('title')} required />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('description')}</Label>
                      <Textarea value={goalDesc} onChange={e => setGoalDesc(e.target.value)} rows={2} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('goal_steps')} ({t('optional')})</Label>
                      <div className="space-y-2">
                        {goalSteps.map((s, i) => (
                          <div key={i} className="flex gap-2">
                            <Input value={s} onChange={e => setGoalSteps(goalSteps.map((v, j) => j === i ? e.target.value : v))} placeholder={`Step ${i + 1}`} />
                            {goalSteps.length > 1 && (
                              <button type="button" onClick={() => setGoalSteps(goalSteps.filter((_, j) => j !== i))} className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button type="button" onClick={() => setGoalSteps([...goalSteps, ''])} className="text-sm text-blue-600 hover:underline">
                          + {t('goal_add_step')}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('add')}...</> : t('add')}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {goals.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-400">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('no_data')}</p>
              </div>
            )}
            {goals.map(goal => {
              const progress = goal.goal_steps.length === 0
                ? (goal.completed ? 100 : 0)
                : Math.round((goal.goal_steps.filter(s => s.completed).length / goal.goal_steps.length) * 100)
              return (
                <Card key={goal.id} className="border-0 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-gray-900">{goal.title}</CardTitle>
                      {canManage && (
                        <button onClick={() => handleDeleteGoal(goal.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {goal.description && <p className="text-xs text-gray-500">{goal.description}</p>}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">{t('goal_progress')}</span>
                      <span className="text-xs font-bold text-gray-700">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    {goal.goal_steps.length > 0 && (
                      <div className="space-y-1.5">
                        {goal.goal_steps.sort((a, b) => a.position - b.position).map(step => (
                          <button key={step.id} onClick={() => handleToggleStep(goal.id, step.id, step.completed)} className="w-full flex items-center gap-2 text-left group">
                            <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${step.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 group-hover:border-green-400'}`}>
                              {step.completed && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <span className={`text-xs ${step.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{step.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {progress === 100 && (
                      <div className="mt-3 p-2 bg-green-50 rounded-lg text-center">
                        <p className="text-xs text-green-700 font-medium">{t('goal_completed')}!</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        {/* EVALUATION CRITERIA TAB */}
        <TabsContent value="evaluation">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-900">{t('evaluation_title')}</h2>
            {canManage && (
              <Dialog open={addCriteriaOpen} onOpenChange={(v) => { setAddCriteriaOpen(v); if (!v) { setCriteriaText(''); setCriteriaType('excellent') } }}>
                <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
                  <Plus className="w-4 h-4" />
                  {t('evaluation_new')}
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t('evaluation_new')}</DialogTitle></DialogHeader>
                  <form onSubmit={handleAddCriteria} className="space-y-4 mt-2">
                    <div className="space-y-2">
                      <Label>{t('type_label')}</Label>
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => setCriteriaType('excellent')}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${criteriaType === 'excellent' ? 'bg-green-50 border-green-200 text-green-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                          {t('evaluation_excellent')}
                        </button>
                        <button type="button"
                          onClick={() => setCriteriaType('poor')}
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
                    {canManage && (
                      <button onClick={() => handleDeleteCriteria(c.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
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
                    {canManage && (
                      <button onClick={() => handleDeleteCriteria(c.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* VISION & MISSION TAB */}
        <TabsContent value="vision_mission">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Vision */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className={`flex items-center justify-between mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Compass className="w-5 h-5 text-blue-500" />
                  {t('dept_vision')}
                </h2>
                {canManage && !editingVision && (
                  <button
                    onClick={() => setEditingVision(true)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    {t('edit')}
                  </button>
                )}
              </div>

              {editingVision ? (
                <div className="space-y-3">
                  <textarea
                    value={vision}
                    onChange={e => setVision(e.target.value)}
                    placeholder={t('dept_vision_ph')}
                    rows={5}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveVision}
                      disabled={savingVision}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                      {savingVision ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {t('save')}
                    </button>
                    <button
                      onClick={() => { setEditingVision(false); setVision(department.vision ?? '') }}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {vision || <span className="text-gray-300 italic">{t('dept_not_set')}</span>}
                </p>
              )}
            </div>

            {/* Mission */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className={`flex items-center justify-between mb-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
                <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Target className="w-5 h-5 text-emerald-500" />
                  {t('dept_mission')}
                </h2>
                {canManage && !editingMission && (
                  <button
                    onClick={() => setEditingMission(true)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    {t('edit')}
                  </button>
                )}
              </div>

              {editingMission ? (
                <div className="space-y-3">
                  <textarea
                    value={mission}
                    onChange={e => setMission(e.target.value)}
                    placeholder={t('dept_mission_ph')}
                    rows={5}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveMission}
                      disabled={savingMission}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                      {savingMission ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {t('save')}
                    </button>
                    <button
                      onClick={() => { setEditingMission(false); setMission(department.mission ?? '') }}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {mission || <span className="text-gray-300 italic">{t('dept_not_set')}</span>}
                </p>
              )}
            </div>

          </div>
        </TabsContent>

        {/* FILES TAB */}
        <TabsContent value="files">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('dept_files')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('dept_files_allowed')}</p>
            </div>
            {canManage && (
              <label className={`inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors cursor-pointer ${uploadingFile ? 'opacity-60 pointer-events-none' : ''}`}>
                {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingFile ? t('dept_files_uploading') : t('dept_files_upload')}
                <input
                  type="file"
                  accept=".pdf,.zip,.xlsx,.csv"
                  className="hidden"
                  onChange={handleUploadFile}
                  disabled={uploadingFile}
                />
              </label>
            )}
          </div>

          {deptFiles.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <FileArchive className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t('dept_files_empty')}</p>
              <p className="text-xs mt-1 opacity-60">{t('dept_files_allowed')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deptFiles.map(file => (
                <div key={file.id} className="flex items-center gap-3 p-4 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow transition-shadow">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                    {getFileIcon(file.file_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs uppercase font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{file.file_type}</span>
                      {file.file_size && <span className="text-xs text-gray-400">{formatBytes(file.file_size)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={getFilePublicUrl(file.file_path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...(file.file_type !== 'pdf' ? { download: file.name } : {})}
                      className="p-1.5 rounded-md hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(file)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* CHECKLIST TAB */}
        <TabsContent value="checklist">
          <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-blue-500" />
                {t('dept_checklist')}
              </h2>
              {checklist.length > 0 && (
                <p className="text-sm text-gray-400 mt-0.5">
                  {t('dept_checklist_progress')}: {checklist.filter(i => i.completed).length}/{checklist.length}
                </p>
              )}
            </div>
            {canManage && (
              <button
                onClick={() => { setEditChecklistItem(null); setClTitle(''); setClDesc(''); setChecklistOpen(true) }}
                className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Plus className="w-4 h-4" /> {t('dept_checklist_add')}
              </button>
            )}
          </div>
          {checklist.length > 0 && (
            <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(checklist.filter(i => i.completed).length / checklist.length) * 100}%` }}
              />
            </div>
          )}
          {checklist.length === 0 ? (
            <div className="text-center py-20">
              <CheckSquare className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-sm text-gray-400">{t('dept_checklist_empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checklist.map(item => (
                <div key={item.id} className={`bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 group ${item.completed ? 'opacity-60' : ''}`}>
                  <button
                    onClick={() => handleToggleChecklist(item)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${item.completed ? 'bg-blue-500 border-blue-500' : 'border-gray-300 hover:border-blue-400'}`}
                  >
                    {item.completed && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium text-gray-900 ${item.completed ? 'line-through text-gray-400' : ''}`}>{item.title}</p>
                    {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditChecklistItem(item); setClTitle(item.title); setClDesc(item.description ?? ''); setChecklistOpen(true) }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteChecklistItem(item)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Checklist Dialog */}
          <Dialog open={checklistOpen} onOpenChange={v => { setChecklistOpen(v); if (!v) { setEditChecklistItem(null); setClTitle(''); setClDesc('') } }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editChecklistItem ? t('dept_checklist_edit') : t('dept_checklist_new')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveChecklist} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>{t('dept_checklist_item_title')}</Label>
                  <Input value={clTitle} onChange={e => setClTitle(e.target.value)} required placeholder={t('dept_checklist_item_title')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('dept_checklist_item_desc')}</Label>
                  <Textarea value={clDesc} onChange={e => setClDesc(e.target.value)} placeholder={t('dept_checklist_item_desc')} rows={3} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setChecklistOpen(false)}>{t('cancel')}</Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}</> : t('save')}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* PAYMENTS TAB */}
        <TabsContent value="payments">
          <PaymentsTab
            profile={profile}
            isSuperAdmin={isSuperAdmin}
            departmentId={department.id}
            departmentName={department.name}
          />
        </TabsContent>

      </Tabs>
    </div>
  )
}
