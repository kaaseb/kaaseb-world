'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Building2, Users, FolderKanban, Trash2, Edit, ArrowRight, Loader2, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface Department {
  id: string
  name: string
  description: string | null
  created_at: string
  department_members: { count: number }[]
  projects: { count: number }[]
}

interface DepartmentsClientProps {
  departments: Department[]
  profile: Profile
  allUsers: Partial<Profile>[]
  isSuperAdmin: boolean
}

export function DepartmentsClient({ departments: initialDepts, profile, allUsers, isSuperAdmin }: DepartmentsClientProps) {
  const { t, isRtl } = useLanguage()
  const [departments, setDepartments] = useState(initialDepts)
  const [createOpen, setCreateOpen] = useState(false)
  const [editDept, setEditDept] = useState<Department | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [addMemberDept, setAddMemberDept] = useState<Department | null>(null)
  const [deptMembers, setDeptMembers] = useState<{ id: string; user_id: string; profiles: { full_name: string | null; email: string } }[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [savingMembers, setSavingMembers] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data, error } = await supabase
      .from('departments')
      .insert({ name, description, created_by: profile.id })
      .select(`*, department_members(count), projects(count)`)
      .single()

    if (error) {
      toast.error('Failed to create department')
    } else {
      setDepartments([data, ...departments])
      setCreateOpen(false)
      setName('')
      setDescription('')
      toast.success('Department created!')
    }
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editDept) return
    setLoading(true)

    const { data, error } = await supabase
      .from('departments')
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq('id', editDept.id)
      .select(`*, department_members(count), projects(count)`)
      .single()

    if (error) {
      toast.error('Failed to update department')
    } else {
      setDepartments(departments.map(d => d.id === editDept.id ? data : d))
      setEditDept(null)
      toast.success('Department updated!')
    }
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this department? This cannot be undone.')) return

    const { error } = await supabase.from('departments').delete().eq('id', id)

    if (error) {
      toast.error('Failed to delete department')
    } else {
      setDepartments(departments.filter(d => d.id !== id))
      toast.success('Department deleted')
    }
  }

  function openEdit(dept: Department) {
    setEditDept(dept)
    setName(dept.name)
    setDescription(dept.description || '')
  }

  async function openAddMembers(dept: Department) {
    setAddMemberDept(dept)
    setLoadingMembers(true)
    const { data } = await supabase
      .from('department_members')
      .select('id, user_id, profiles(full_name, email)')
      .eq('department_id', dept.id)
    setDeptMembers((data || []) as unknown as typeof deptMembers)
    setSelectedUserIds((data || []).map((m: { user_id: string }) => m.user_id))
    setLoadingMembers(false)
  }

  async function handleSaveMembers() {
    if (!addMemberDept) return
    setSavingMembers(true)
    const currentUserIds = deptMembers.map(m => m.user_id)
    const toAdd = selectedUserIds.filter(id => !currentUserIds.includes(id))
    const toRemove = deptMembers.filter(m => !selectedUserIds.includes(m.user_id))

    if (toAdd.length > 0) {
      await supabase.from('department_members').insert(
        toAdd.map(uid => ({ department_id: addMemberDept.id, user_id: uid }))
      )
    }
    for (const m of toRemove) {
      await supabase.from('department_members').delete().eq('id', m.id)
    }

    // Update count in local state
    const newCount = selectedUserIds.length
    setDepartments(prev => prev.map(d =>
      d.id === addMemberDept.id
        ? { ...d, department_members: [{ count: newCount }] }
        : d
    ))

    setAddMemberDept(null)
    setSavingMembers(false)
    toast.success(t('save'))
  }

  return (
    <div className="p-8">
      <div className={`flex items-center justify-between mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('departments_title')}</h1>
          <p className="text-gray-500 mt-1">{departments.length} {t('dept_count')}</p>
        </div>
        {isSuperAdmin && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" />
              {t('department_new')}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('department_new')}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>{t('name')}</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('dept_name_ph')} required />
                </div>
                <div className="space-y-2">
                  <Label>{t('description')}</Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('dept_desc_ph')} rows={3} />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('create')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {departments.length === 0 ? (
        <div className="text-center py-24">
          <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('no_data')}</h3>
          <p className="text-gray-400 text-sm">
            {isSuperAdmin ? t('dept_no_data_admin') : t('dept_no_data_member')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {departments.map((dept) => (
            <Card key={dept.id} className="border-0 shadow-sm hover:shadow-md transition-shadow group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  {isSuperAdmin && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openAddMembers(dept)}
                        className="p-1.5 rounded-md hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                        title={t('add_member')}
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openEdit(dept)}
                        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(dept.id)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <CardTitle className="text-base font-semibold text-gray-900">{dept.name}</CardTitle>
                {dept.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{dept.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {dept.department_members?.[0]?.count || 0} {t('department_members')}
                  </span>
                  <span className="flex items-center gap-1">
                    <FolderKanban className="w-3.5 h-3.5" />
                    {dept.projects?.[0]?.count || 0} {t('department_projects')}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => router.push(`/departments/${dept.id}`)}
                >
                  {t('departments_title')}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Members Dialog */}
      <Dialog open={!!addMemberDept} onOpenChange={(open) => { if (!open) setAddMemberDept(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('add_member')} — {addMemberDept?.name}</DialogTitle>
          </DialogHeader>
          {loadingMembers ? (
            <div className="text-center py-8 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          ) : (
            <div className="space-y-3 mt-2">
              <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-72 overflow-y-auto">
                {allUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.id!)}
                      onChange={e => setSelectedUserIds(prev =>
                        e.target.checked ? [...prev, u.id!] : prev.filter(id => id !== u.id)
                      )}
                      className="accent-gray-900"
                    />
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-gray-600">
                          {(u.full_name || u.email || 'U')[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                      <p className="text-xs text-gray-400">{u.role?.replace('_', ' ')}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500">{selectedUserIds.length} {t('department_members')}</p>
              <Button onClick={handleSaveMembers} disabled={savingMembers} className="w-full">
                {savingMembers ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editDept} onOpenChange={(open) => !open && setEditDept(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('edit')} {t('departments_title')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>{t('name')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>{t('description')}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
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
