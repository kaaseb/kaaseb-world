'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Users, Edit, Zap, Loader2, Mail, Trash2, Building2, CalendarOff, Copy, Check } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

const roleColors: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  project_manager: 'bg-blue-100 text-blue-700',
  employee: 'bg-gray-100 text-gray-600',
}

interface UserProject {
  id: string
  name: string
  status: string
}

interface CustomRoleLite {
  id: string
  name: string
  description: string | null
  permissions: string[]
}

interface UsersClientProps {
  users: Profile[]
  currentProfile: Profile
  userProjects: Record<string, UserProject[]>
  customRoles?: CustomRoleLite[]
}

export function UsersClient({ users: initUsers, currentProfile, userProjects, customRoles = [] }: UsersClientProps) {
  const { t, isRtl } = useLanguage()
  const [users, setUsers] = useState(initUsers)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [newRole, setNewRole] = useState('')
  const [loading, setLoading] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteTitle, setInviteTitle] = useState('')
  const [inviteRole, setInviteRole] = useState('employee')
  const [inviteCustomRoleId, setInviteCustomRoleId] = useState<string>('')
  const [inviteIsDeptManager, setInviteIsDeptManager] = useState(false)
  const [inviteScope, setInviteScope] = useState<string>('both')
  const [inviting, setInviting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [offDayUser, setOffDayUser] = useState<Profile | null>(null)
  const [selectedOffDays, setSelectedOffDays] = useState<number[]>([])
  const [savingOffDays, setSavingOffDays] = useState(false)
  const [editOffDays, setEditOffDays] = useState<number[]>([])
  const [editCustomRoleId, setEditCustomRoleId] = useState<string>('')
  const [editIsDeptManager, setEditIsDeptManager] = useState(false)
  const [editScope, setEditScope] = useState<string>('both')
  // Email change is its own dedicated mini-form inside the edit dialog so
  // the admin has to deliberately click "Change email" — it's a sensitive
  // auth-level operation (controls login + password reset), not a
  // free-rider on the main save handler.
  const [editEmail, setEditEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [inviteOffDays, setInviteOffDays] = useState<number[]>([])
  const [createdCredential, setCreatedCredential] = useState<{ email: string; password: string } | null>(null)
  const [credentialCopied, setCredentialCopied] = useState(false)
  const supabase = createClient()
  const DAY_KEYS = ['day_sun', 'day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat'] as const

  async function handleUpdateRole(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser || !newRole) return
    setLoading(true)

    const { error } = await supabase
      .from('profiles')
      .update({
        role: newRole,
        off_days: editOffDays,
        custom_role_id: editCustomRoleId || null,
        is_department_manager: editIsDeptManager,
        scope: editScope,
      })
      .eq('id', editUser.id)

    if (error) { toast.error('Failed to update') }
    else {
      setUsers(users.map(u => u.id === editUser.id
        ? { ...u,
            role: newRole as Profile['role'],
            off_days: editOffDays,
            custom_role_id: editCustomRoleId || null,
            is_department_manager: editIsDeptManager,
            scope: editScope,
          }
        : u))
      setEditUser(null)
      toast.success('Updated!')
    }
    setLoading(false)
  }

  async function handleDeleteUser(userId: string, name: string) {
    if (!confirm(t('user_delete_confirm'))) return
    setDeletingId(userId)
    const res = await fetch('/api/users/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const result = await res.json()
    if (result.success) {
      setUsers(users.filter(u => u.id !== userId))
      toast.success(t('user_deleted'))
    } else {
      toast.error(result.error || 'Failed to delete user')
    }
    setDeletingId(null)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteEmail,
        role: inviteRole,
        fullName: inviteFullName,
        title: inviteTitle,
        offDays: inviteOffDays,
        customRoleId: inviteCustomRoleId || null,
        isDepartmentManager: inviteIsDeptManager,
        scope: inviteScope,
      }),
    })
    const result = await res.json()
    if (result.success) {
      // Show the one-time password to the admin in a dialog so they can copy it
      // and hand it to the new user. The server never persists this in plaintext.
      if (result.password) {
        setCreatedCredential({ email: inviteEmail, password: result.password })
        setCredentialCopied(false)
      } else {
        toast.success(`User ${inviteEmail} created`)
      }
      setInviteOpen(false)
      setInviteEmail('')
      setInviteFullName('')
      setInviteTitle('')
      setInviteRole('employee')
      setInviteOffDays([])
      setInviteCustomRoleId('')
      setInviteIsDeptManager(false)
      setInviteScope('both')
    } else {
      toast.error(result.error || 'Failed to create user')
    }
    setInviting(false)
  }

  async function handleChangeEmail() {
    if (!editUser) return
    const next = editEmail.trim().toLowerCase()
    if (!next) {
      toast.error(t('user_email_invalid'))
      return
    }
    if (next === (editUser.email || '').toLowerCase()) {
      // No-op — let the admin know nothing changed instead of silently doing
      // a round-trip that lands on the API's "unchanged" branch.
      toast.message(t('user_email_unchanged'))
      return
    }
    if (!confirm(t('user_email_confirm'))) return
    setSavingEmail(true)
    const res = await fetch('/api/users/email', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: editUser.id, email: next }),
    })
    const result = await res.json()
    setSavingEmail(false)
    if (!res.ok || !result.success) {
      toast.error(result.error || 'Failed')
      return
    }
    // Reflect the change on both the open dialog and the list underneath so
    // the admin doesn't see a stale value after closing.
    setUsers(users.map(u => u.id === editUser.id ? { ...u, email: result.email } : u))
    setEditUser({ ...editUser, email: result.email })
    toast.success(t('user_email_updated'))
  }

  async function handleSaveOffDays() {
    if (!offDayUser) return
    setSavingOffDays(true)
    const { error } = await supabase
      .from('profiles')
      .update({ off_days: selectedOffDays })
      .eq('id', offDayUser.id)
    if (error) { toast.error('Failed to save') }
    else {
      setUsers(users.map(u => u.id === offDayUser.id ? { ...u, off_days: selectedOffDays } : u))
      toast.success(t('off_days_saved'))
      setOffDayUser(null)
    }
    setSavingOffDays(false)
  }

  return (
    <div className="p-8">
      <div className={`flex items-center justify-between mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6" />
            {t('users_title')}
          </h1>
          <p className="text-gray-500 mt-1">{users.length} {t('users_registered')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Mail className="w-4 h-4" /> {t('user_add')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {users.map(user => (
          <Card key={user.id} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-gray-600">
                    {(user.full_name || user.email || 'U')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm text-gray-900">{user.full_name || 'No name'}</p>
                  {user.id === currentProfile.id && (
                    <span className="text-xs text-gray-400">{t('user_you')}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500">{user.email}</p>
                {(userProjects[user.id]?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {userProjects[user.id].map(p => (
                      <span key={p.id} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium">
                        <Building2 className="w-3 h-3" />
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs font-bold text-amber-600">
                  <Zap className="w-3 h-3" />
                  {user.total_points} {t('user_pts')}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[user.role] || roleColors.employee}`}>
                  {user.role === 'super_admin' ? t('role_super_admin') : user.role === 'project_manager' ? t('role_project_manager') : t('role_employee')}
                </span>
                {user.id !== currentProfile.id && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditUser(user); setNewRole(user.role); setEditOffDays(user.off_days ?? [])
                        setEditCustomRoleId(user.custom_role_id || '')
                        setEditIsDeptManager(user.is_department_manager || false)
                        setEditScope(user.scope || 'both')
                        setEditEmail(user.email || '')
                      }}
                      className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { setOffDayUser(user); setSelectedOffDays(user.off_days ?? []) }}
                      className="p-1.5 rounded-md hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition-colors"
                      title={t('off_days_title')}
                    >
                      <CalendarOff className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id, user.full_name || user.email)}
                      disabled={deletingId === user.id}
                      className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      {deletingId === user.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Role Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('user_change_role')} — {editUser?.full_name || editUser?.email}</DialogTitle>
          </DialogHeader>
          {/* Email change — sits OUTSIDE the role form so it has its own
              save button. Submitting the role form does NOT change the email;
              the admin has to click "Change email" explicitly. */}
          <div className="space-y-1.5 mt-2 pb-4 border-b">
            <Label>{t('email')}</Label>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="user@example.com"
                dir="ltr"
                disabled={savingEmail}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleChangeEmail}
                disabled={savingEmail || !editEmail.trim()}
              >
                {savingEmail
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : t('user_change_email')}
              </Button>
            </div>
            <p className="text-[11px] text-gray-400">{t('user_change_email_hint')}</p>
          </div>

          <form onSubmit={handleUpdateRole} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>{t('user_select_role')} *</Label>
              <div className="space-y-2">
                {[
                  { value: 'employee', label: t('role_employee'), desc: t('role_employee_desc') },
                  { value: 'project_manager', label: t('role_project_manager'), desc: t('role_pm_desc') },
                  { value: 'super_admin', label: t('role_super_admin'), desc: t('role_admin_desc') },
                ].map(role => (
                  <button
                    key={role.value}
                    type="button"
                    onClick={() => setNewRole(role.value)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${newRole === role.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <p className="text-sm font-medium text-gray-900">{role.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{role.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {customRoles.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t('user_custom_role')}</Label>
                <select
                  value={editCustomRoleId}
                  onChange={e => setEditCustomRoleId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">— {t('user_custom_role_none')} —</option>
                  {customRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* User scope selector removed — App + Washhouses modules retired (replaced by Furn). */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={editIsDeptManager}
                onChange={e => setEditIsDeptManager(e.target.checked)}
                className="accent-gray-900"
              />
              <span className="text-gray-700">{t('user_is_dept_manager')}</span>
            </label>
            <div className="space-y-2">
              <Label>{t('off_days_title')}</Label>
              <div className="grid grid-cols-2 gap-2">
                {DAY_KEYS.map((key, idx) => {
                  const selected = editOffDays.includes(idx)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditOffDays(selected ? editOffDays.filter(d => d !== idx) : [...editOffDays, idx])}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm font-medium transition-colors ${selected ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${selected ? 'bg-purple-500 border-purple-500' : 'border-gray-300'}`}>
                        {selected && <span className="text-white text-xs">✓</span>}
                      </span>
                      {t(key)}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('user_update_role')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Off Days Dialog */}
      <Dialog open={!!offDayUser} onOpenChange={(open) => !open && setOffDayUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('off_days_title')} — {offDayUser?.full_name || offDayUser?.email}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-gray-500 -mt-1">{t('off_days_desc')}</p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {DAY_KEYS.map((key, idx) => {
              const selected = selectedOffDays.includes(idx)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedOffDays(
                    selected ? selectedOffDays.filter(d => d !== idx) : [...selectedOffDays, idx]
                  )}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    selected ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${selected ? 'bg-purple-500 border-purple-500' : 'border-gray-300'}`}>
                    {selected && <span className="text-white text-xs">✓</span>}
                  </span>
                  {t(key)}
                </button>
              )
            })}
          </div>
          <Button
            onClick={handleSaveOffDays}
            disabled={savingOffDays}
            className="w-full mt-2"
          >
            {savingOffDays ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('off_days_save')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t('user_add_title')}</DialogTitle></DialogHeader>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 font-medium">
            {t('invite_random_password_note')}
          </div>
          <form onSubmit={handleInvite} className="space-y-4 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('full_name')}</Label>
                <Input
                  value={inviteFullName}
                  onChange={e => setInviteFullName(e.target.value)}
                  placeholder={t('user_full_name_ph')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('email')}</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>{t('settings_profile_title')}</Label>
                <Input
                  value={inviteTitle}
                  onChange={e => setInviteTitle(e.target.value)}
                  placeholder={t('settings_profile_title_ph')}
                  maxLength={40}
                />
                <p className="text-xs text-gray-400">{t('settings_profile_title_hint')}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('role')}</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'employee', label: t('role_employee') },
                  { value: 'project_manager', label: t('role_project_manager') },
                  { value: 'super_admin', label: t('role_super_admin') },
                ].map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setInviteRole(r.value)}
                    className={`p-2.5 rounded-lg border text-sm font-medium text-center transition-colors ${inviteRole === r.value ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {customRoles.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t('user_custom_role')}</Label>
                <select
                  value={inviteCustomRoleId}
                  onChange={e => setInviteCustomRoleId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">— {t('user_custom_role_none')} —</option>
                  {customRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
            {/* User scope selector removed — App + Washhouses modules retired (replaced by Furn). */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={inviteIsDeptManager}
                onChange={e => setInviteIsDeptManager(e.target.checked)}
                className="accent-gray-900"
              />
              <span className="text-gray-700">{t('user_is_dept_manager')}</span>
            </label>
            <div className="space-y-1.5">
              <Label>{t('off_days_title')}</Label>
              <div className="grid grid-cols-4 gap-2">
                {DAY_KEYS.map((key, idx) => {
                  const selected = inviteOffDays.includes(idx)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setInviteOffDays(selected ? inviteOffDays.filter(d => d !== idx) : [...inviteOffDays, idx])}
                      className={`flex items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-medium transition-colors ${selected ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${selected ? 'bg-purple-500 border-purple-500' : 'border-gray-300'}`}>
                        {selected && <span className="text-white text-[10px]">✓</span>}
                      </span>
                      {t(key)}
                    </button>
                  )
                })}
              </div>
            </div>
            <Button type="submit" disabled={inviting} className="w-full">
              {inviting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('user_create')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* One-time credential viewer — shown after a successful invite. */}
      <Dialog open={!!createdCredential} onOpenChange={(o) => { if (!o) setCreatedCredential(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('invite_credential_title')}</DialogTitle>
          </DialogHeader>
          {createdCredential && (
            <div className="space-y-4">
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                {t('invite_credential_warning')}
              </p>
              <div>
                <Label className="text-xs text-gray-500">{t('invite_credential_email')}</Label>
                <div className="mt-1 px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono break-all">
                  {createdCredential.email}
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">{t('invite_credential_password')}</Label>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono select-all break-all">
                    {createdCredential.password}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(createdCredential.password)
                        setCredentialCopied(true)
                        toast.success(t('copied'))
                      } catch {
                        toast.error('Copy failed')
                      }
                    }}
                  >
                    {credentialCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => setCreatedCredential(null)}
                className="w-full"
                disabled={!credentialCopied}
              >
                {credentialCopied ? t('done') : t('invite_credential_must_copy')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
