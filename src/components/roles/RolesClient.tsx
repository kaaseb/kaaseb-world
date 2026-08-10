'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, BadgeCheck, Edit, Trash2, Loader2 } from 'lucide-react'
import type { Profile, CustomRole } from '@/types'
import { PERMISSIONS, PERMISSION_MODULES, MODULE_COVERED_KEYS, type PermissionModule } from '@/lib/permissions'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  profile: Profile
  initRoles: CustomRole[]
}

export function RolesClient({ initRoles }: Props) {
  const { t, isRtl, lang } = useLanguage()
  const ar = lang === 'ar'
  const supabase = createClient()
  const [roles, setRoles] = useState(initRoles)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRole, setEditRole] = useState<CustomRole | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // Permission keys not owned by any module's read/write — shown as plain
  // advanced toggles so nothing is lost.
  const advancedPerms = useMemo(
    () => PERMISSIONS.filter((p) => !MODULE_COVERED_KEYS.has(p.key) && p.group !== 'Hidden'),
    [],
  )

  // ── Read / Write per module (operates on the flat selectedPerms set) ────────
  const isRead = (m: PermissionModule) => selectedPerms.has(m.read)
  const isWrite = (m: PermissionModule) => m.write.length > 0 && m.write.every((k) => selectedPerms.has(k))
  function setModule(m: PermissionModule, read: boolean, write: boolean) {
    const s = new Set(selectedPerms)
    if (read || write) s.add(m.read); else s.delete(m.read)
    for (const k of m.write) { if (write) s.add(k); else s.delete(k) }
    setSelectedPerms(s)
  }
  // Turning read OFF also drops write (can't edit what you can't see); turning
  // write ON implies read.
  const toggleRead = (m: PermissionModule) => (isRead(m) ? setModule(m, false, false) : setModule(m, true, false))
  const toggleWrite = (m: PermissionModule) => (isWrite(m) ? setModule(m, true, false) : setModule(m, true, true))

  function openCreate() {
    setEditRole(null)
    setName('')
    setDescription('')
    setSelectedPerms(new Set())
    setDialogOpen(true)
  }

  function openEdit(r: CustomRole) {
    setEditRole(r)
    setName(r.name)
    setDescription(r.description || '')
    setSelectedPerms(new Set(r.permissions || []))
    setDialogOpen(true)
  }

  function toggle(k: string) {
    const s = new Set(selectedPerms)
    if (s.has(k)) s.delete(k)
    else s.add(k)
    setSelectedPerms(s)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      permissions: Array.from(selectedPerms),
      updated_at: new Date().toISOString(),
    }
    if (editRole) {
      const { data, error } = await supabase
        .from('custom_roles').update(payload).eq('id', editRole.id).select('*').single()
      if (error) toast.error(error.message)
      else { setRoles(roles.map(r => r.id === editRole.id ? (data as CustomRole) : r)); toast.success(t('saved')); setDialogOpen(false) }
    } else {
      const { data, error } = await supabase
        .from('custom_roles').insert(payload).select('*').single()
      if (error) toast.error(error.message)
      else { setRoles([data as CustomRole, ...roles]); toast.success(t('created')); setDialogOpen(false) }
    }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm(t('confirm_delete'))) return
    const { error } = await supabase.from('custom_roles').delete().eq('id', id)
    if (error) toast.error(error.message)
    else { setRoles(roles.filter(r => r.id !== id)); toast.success(t('deleted')) }
  }

  return (
    <div className="p-8">
      <div className={`flex items-center justify-between mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BadgeCheck className="w-6 h-6" />
            {t('nav_roles')}
          </h1>
          <p className="text-gray-500 mt-1">{roles.length}</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="w-4 h-4" />{t('role_new')}
        </Button>
      </div>

      {roles.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BadgeCheck className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm">{t('roles_empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(r => (
            <Card key={r.id} className="border-0 shadow-sm group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(r)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500">
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(r.id)} className="p-1.5 rounded-md hover:bg-red-50 text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {r.description && <p className="text-xs text-gray-500 mb-2 line-clamp-2">{r.description}</p>}
                <p className="text-xs text-gray-400">{(r.permissions || []).length} {t('role_permissions')}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editRole ? t('role_edit') : t('role_new')}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4 mt-2 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label>{t('name')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('role_name_ph')} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-3">
              <Label>{ar ? 'الصلاحيات' : 'Permissions'}</Label>
              <p className="text-xs text-muted-foreground -mt-1.5">
                {ar ? '«قراءة» = عرض فقط · «تعديل» = عرض + إنشاء/تعديل/حذف' : 'Read = view only · Write = view + create/edit/delete'}
              </p>
              <div className="border rounded-lg divide-y">
                {PERMISSION_MODULES.map((m) => {
                  const read = isRead(m), write = isWrite(m)
                  return (
                    <div key={m.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm font-medium text-gray-800">{ar ? m.ar : m.en}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button type="button" onClick={() => toggleRead(m)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${read ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                          {ar ? 'قراءة' : 'Read'}
                        </button>
                        {m.write.length > 0 && (
                          <button type="button" onClick={() => toggleWrite(m)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${write ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                            {ar ? 'تعديل' : 'Write'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {advancedPerms.length > 0 && (
                <div className="border border-gray-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">{ar ? 'صلاحيات متقدّمة' : 'Advanced'}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {advancedPerms.map((p) => (
                      <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5">
                        <input type="checkbox" checked={selectedPerms.has(p.key)} onChange={() => toggle(p.key)} className="accent-gray-900" />
                        <span className="text-gray-700">{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
