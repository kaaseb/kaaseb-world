'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { FolderKanban, CheckSquare, ArrowRight, Trash2, Edit, Loader2, Building2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

interface Project {
  id: string
  name: string
  description: string | null
  status: string
  department_id: string
  created_by: string
  created_at: string
  departments: { name: string } | null
  tasks: { count: number }[]
}

interface ProjectsClientProps {
  projects: Project[]
  departments: { id: string; name: string }[]
  profile: Profile
  isSuperAdmin: boolean
}

export function ProjectsClient({ projects: initialProjects, departments, profile, isSuperAdmin }: ProjectsClientProps) {
  const { t, isRtl } = useLanguage()
  const [projects, setProjects] = useState(initialProjects)
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState('active')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  function resetForm() {
    setName(''); setDescription(''); setDepartmentId(''); setStatus('active')
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!departmentId) { toast.error('Please select a department'); return }
    setLoading(true)

    const { data, error } = await supabase
      .from('projects')
      .insert({ name, description, department_id: departmentId, status, created_by: profile.id })
      .select(`*, departments(name), tasks(count)`)
      .single()

    if (error) { toast.error('Failed to create project') }
    else {
      setProjects([data, ...projects])
      setCreateOpen(false)
      resetForm()
      toast.success('Project created!')
    }
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editProject) return
    setLoading(true)

    const { data, error } = await supabase
      .from('projects')
      .update({ name, description, status, updated_at: new Date().toISOString() })
      .eq('id', editProject.id)
      .select(`*, departments(name), tasks(count)`)
      .single()

    if (error) { toast.error('Failed to update project') }
    else {
      setProjects(projects.map(p => p.id === editProject.id ? data : p))
      setEditProject(null)
      toast.success('Project updated!')
    }
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project? All tasks will be deleted too.')) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { toast.error('Failed to delete') }
    else { setProjects(projects.filter(p => p.id !== id)); toast.success('Project deleted') }
  }

  function openEdit(project: Project) {
    setEditProject(project)
    setName(project.name)
    setDescription(project.description || '')
    setStatus(project.status)
  }

  const ProjectForm = ({ onSubmit, isEdit = false }: { onSubmit: (e: React.FormEvent) => void, isEdit?: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-4 mt-2">
      <div className="space-y-2">
        <Label>{t('name')}</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('project_name')} required />
      </div>
      <div className="space-y-2">
        <Label>{t('description')}</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project about?" rows={3} />
      </div>
      {!isEdit && (
        <div className="space-y-2">
          <Label>{t('department_name')}</Label>
          <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? '')}>
            <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
            <SelectContent>
              {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>{t('status')}</Label>
        <Select value={status} onValueChange={(v) => setStatus(v ?? 'active')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t('project_status_active')}</SelectItem>
            <SelectItem value="completed">{t('project_status_completed')}</SelectItem>
            <SelectItem value="archived">{t('project_status_archived')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isEdit ? t('saving') : t('creating')}...</> : isEdit ? t('save') : t('create')}
      </Button>
    </form>
  )

  return (
    <div className="p-8">
      <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('projects_title')}</h1>
          <p className="text-gray-500 mt-1">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => router.push('/departments')}
          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Building2 className="w-4 h-4" />
          {t('departments_title')}
        </button>
      </div>
      <div className="mb-6 p-4 bg-blue-50 rounded-xl flex items-start gap-3">
        <Building2 className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-900">Create projects from inside a Department</p>
          <p className="text-xs text-blue-600 mt-0.5">Navigate to a department and use the Projects tab to create new projects there.</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-24">
          <FolderKanban className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('no_data')}</h3>
          <p className="text-gray-400 text-sm">Create your first project to start managing tasks.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} className="border-0 shadow-sm hover:shadow-md transition-shadow group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center mb-3">
                    <FolderKanban className="w-5 h-5 text-violet-600" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[project.status] || statusColors.active}`}>
                      {project.status}
                    </span>
                    {(isSuperAdmin || project.created_by === profile.id) && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                        <button onClick={() => openEdit(project)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(project.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <CardTitle className="text-base font-semibold text-gray-900">{project.name}</CardTitle>
                {project.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{project.description}</p>}
                {project.departments && <p className="text-xs text-blue-600 mt-2 font-medium">{project.departments.name}</p>}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                  <CheckSquare className="w-3.5 h-3.5" />
                  {project.tasks?.[0]?.count || 0} {t('tasks_count')}
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => router.push(`/project-board/${project.id}`)}>
                  {t('kanban_board')} <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('edit')} {t('projects_title')}</DialogTitle></DialogHeader>
          <ProjectForm onSubmit={handleEdit} isEdit />
        </DialogContent>
      </Dialog>
    </div>
  )
}
