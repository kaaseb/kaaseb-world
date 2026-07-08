'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Users, Crown, UserPlus, X, Search, Loader2, UserMinus, Pencil, Trash2, Camera } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile, ChatMember } from '@/types'
import type { ConvWithMembers } from './CommunityChatClient'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: ConvWithMembers
  currentUser: Profile
  allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  onConversationUpdate: (c: ConvWithMembers) => void
}

export function GroupInfoDialog({ open, onOpenChange, conversation, currentUser, allUsers, onConversationUpdate }: Props) {
  const { t } = useLanguage()
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'view' | 'add' | 'edit'>('view')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Edit group state
  const [editName, setEditName] = useState(conversation.name || '')
  const [editDescription, setEditDescription] = useState(conversation.description || '')
  const [editImageUrl, setEditImageUrl] = useState<string | null>(conversation.image_url)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const meAsMember = conversation.chat_members.find(m => m.user_id === currentUser.id)
  const isSuperAdmin = currentUser.role === 'super_admin'
  const canManage = isSuperAdmin || !!meAsMember?.is_admin

  const existingIds = useMemo(
    () => new Set(conversation.chat_members.map(m => m.user_id)),
    [conversation.chat_members],
  )

  const candidates = useMemo(() => {
    const pool = allUsers.filter(u => !existingIds.has(u.id))
    if (!query.trim()) return pool
    const q = query.toLowerCase()
    return pool.filter(u => (u.full_name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [allUsers, existingIds, query])

  function toggle(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  async function addMembers() {
    if (selected.size === 0) return
    setSaving(true)
    const rows = Array.from(selected).map(uid => ({
      conversation_id: conversation.id,
      user_id: uid,
      is_admin: false,
    }))
    const { error } = await supabase.from('chat_members').insert(rows)
    if (error) { toast.error(error.message); setSaving(false); return }

    // Refetch members with profile info to update UI
    const { data: updated } = await supabase
      .from('chat_members')
      .select('*, profiles(id, full_name, email, avatar_url, title)')
      .eq('conversation_id', conversation.id)

    onConversationUpdate({
      ...conversation,
      chat_members: (updated || []) as ConvWithMembers['chat_members'],
    })
    toast.success(t('group_members_added'))
    setSelected(new Set())
    setQuery('')
    setMode('view')
    setSaving(false)
  }

  async function removeMember(m: ChatMember) {
    if (!confirm(t('group_remove_confirm'))) return
    setRemovingId(m.id)
    const { error } = await supabase.from('chat_members').delete().eq('id', m.id)
    if (error) { toast.error(error.message); setRemovingId(null); return }
    onConversationUpdate({
      ...conversation,
      chat_members: conversation.chat_members.filter(x => x.id !== m.id),
    })
    setRemovingId(null)
    toast.success(t('group_member_removed'))
  }

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'chat')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) setEditImageUrl(result.url); else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  function openEditMode() {
    setEditName(conversation.name || '')
    setEditDescription(conversation.description || '')
    setEditImageUrl(conversation.image_url)
    setMode('edit')
  }

  async function saveGroupEdits(e: React.FormEvent) {
    e.preventDefault()
    if (!editName.trim()) { toast.error(t('group_name_required')); return }
    setSaving(true)
    const { data, error } = await supabase
      .from('chat_conversations')
      .update({
        name: editName.trim(),
        description: editDescription.trim() || null,
        image_url: editImageUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)
      .select('*')
      .single()
    if (error) { toast.error(error.message); setSaving(false); return }
    onConversationUpdate({ ...conversation, ...data })
    toast.success(t('saved'))
    setMode('view')
    setSaving(false)
  }

  async function deleteGroup() {
    if (!confirm(t('group_delete_confirm'))) return
    if (!confirm(t('group_delete_confirm_final'))) return
    setSaving(true)
    const { error } = await supabase.from('chat_conversations').delete().eq('id', conversation.id)
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(t('group_deleted'))
    onOpenChange(false)
    router.push('/community')
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setMode('view'); setSelected(new Set()); setQuery('') } }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>{t('group_info')}</DialogTitle></DialogHeader>

        <div className="flex flex-col items-center mt-2 pb-4 border-b border-gray-100">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white flex items-center justify-center overflow-hidden">
            {conversation.image_url
              ? <img src={conversation.image_url} alt="" className="w-full h-full object-cover" />
              : <Users className="w-8 h-8" />}
          </div>
          <h3 className="mt-3 text-lg font-bold text-gray-900">{conversation.name}</h3>
          {conversation.description && (
            <p className="text-sm text-gray-500 text-center mt-1">{conversation.description}</p>
          )}
          {canManage && mode === 'view' && (
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={openEditMode}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold"
              >
                <Pencil className="w-3.5 h-3.5" />{t('group_edit')}
              </button>
              <button
                type="button"
                onClick={deleteGroup}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />{t('group_delete')}
              </button>
            </div>
          )}
        </div>

        {mode === 'edit' ? (
          <form onSubmit={saveGroupEdits} className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t('group_edit')}</p>
              <button type="button" onClick={() => setMode('view')} className="text-xs text-gray-500 hover:text-gray-700">
                {t('cancel')}
              </button>
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative w-20 h-20 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white flex items-center justify-center overflow-hidden hover:opacity-90"
              >
                {editImageUrl
                  ? <img src={editImageUrl} alt="" className="w-full h-full object-cover" />
                  : <Users className="w-8 h-8" />}
                <span className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('group_name')} *</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')}</Label>
              <Textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2} />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        ) : mode === 'view' ? (
          <>
            <div className="flex items-center justify-between pt-3 pb-2">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {conversation.chat_members.length} {t('members_count')}
              </p>
              {canManage && (
                <button
                  onClick={() => setMode('add')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700"
                >
                  <UserPlus className="w-3.5 h-3.5" />{t('group_add_members')}
                </button>
              )}
            </div>
            <ul className="space-y-1 flex-1 overflow-y-auto">
              {conversation.chat_members.map(m => {
                const isMe = m.user_id === currentUser.id
                const canRemove = canManage && !isMe && !m.is_admin
                return (
                  <li key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                    <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                      {m.profiles?.avatar_url
                        ? <img src={m.profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-gray-500">{(m.profiles?.full_name || m.profiles?.email || 'U')[0].toUpperCase()}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {m.profiles?.full_name || m.profiles?.email}
                        {isMe && <span className="ms-1.5 text-xs text-gray-400">({t('you')})</span>}
                      </p>
                    </div>
                    {m.is_admin && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        <Crown className="w-3 h-3" />{t('admin')}
                      </span>
                    )}
                    {canRemove && (
                      <button
                        onClick={() => removeMember(m)}
                        disabled={removingId === m.id}
                        className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50"
                        title={t('group_remove')}
                      >
                        {removingId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between pt-3 pb-2">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t('group_add_members')}</p>
              <button
                onClick={() => { setMode('view'); setSelected(new Set()); setQuery('') }}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >{t('cancel')}</button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('chat_search_users')} className="ps-9" />
            </div>
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Array.from(selected).map(id => {
                  const u = allUsers.find(x => x.id === id)
                  if (!u) return null
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 pe-2 ps-1 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs">
                      <div className="w-5 h-5 rounded-full bg-purple-200 overflow-hidden">
                        {u.avatar_url
                          ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <span className="text-[9px] font-bold leading-5 block text-center">{(u.full_name || u.email)[0].toUpperCase()}</span>}
                      </div>
                      <span className="truncate max-w-[120px]">{u.full_name || u.email}</span>
                      <button onClick={() => toggle(id)} className="text-purple-400 hover:text-purple-700"><X className="w-3 h-3" /></button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="mt-2 flex-1 overflow-y-auto space-y-1">
              {candidates.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">{t('group_no_more_users')}</p>
              ) : candidates.map(u => (
                <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-purple-600" />
                  <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-gray-500">{(u.full_name || u.email)[0].toUpperCase()}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                  </div>
                </label>
              ))}
            </div>
            <Button onClick={addMembers} disabled={saving || selected.size === 0} className="w-full mt-2">
              {saving
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</>
                : <>{t('group_add_selected')} ({selected.size})</>}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
