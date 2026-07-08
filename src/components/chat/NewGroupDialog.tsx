'use client'

import { useState, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Search, Users, Loader2, Camera, X } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'
import type { ConvWithMembers } from './CommunityChatClient'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUserId: string
  allUsers: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  onCreated: (conv: ConvWithMembers) => void
}

export function NewGroupDialog({ open, onOpenChange, currentUserId, allUsers, onCreated }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [step, setStep] = useState<'details' | 'members'>('details')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return allUsers
    const q = query.toLowerCase()
    return allUsers.filter(u => (u.full_name || '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [query, allUsers])

  function reset() {
    setStep('details'); setName(''); setDescription(''); setImageUrl(null)
    setQuery(''); setSelected(new Set())
  }

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'chat')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) setImageUrl(result.url); else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  function toggle(id: string) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  async function createGroup() {
    if (!name.trim()) { toast.error(t('group_name_required')); return }
    if (selected.size === 0) { toast.error(t('group_members_required')); return }
    setCreating(true)

    const { data: conv, error } = await supabase
      .from('chat_conversations')
      .insert({ type: 'group', name: name.trim(), description: description.trim() || null, image_url: imageUrl, created_by: currentUserId })
      .select('*').single()
    if (error || !conv) { toast.error(error?.message || 'Failed'); setCreating(false); return }

    const memberRows = [
      { conversation_id: conv.id, user_id: currentUserId, is_admin: true },
      ...Array.from(selected).map(id => ({ conversation_id: conv.id, user_id: id, is_admin: false })),
    ]
    const { error: memErr } = await supabase.from('chat_members').insert(memberRows)
    if (memErr) { toast.error(memErr.message); setCreating(false); return }

    const { data: membersData } = await supabase
      .from('chat_members').select('*, profiles(id, full_name, email, avatar_url, title)').eq('conversation_id', conv.id)

    onCreated({ ...conv, chat_members: (membersData || []) as ConvWithMembers['chat_members'], last_message: null })
    toast.success(t('group_created'))
    reset()
    setCreating(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-600" />
            {t('chat_new_group')}
          </DialogTitle>
        </DialogHeader>

        {step === 'details' ? (
          <div className="space-y-4 mt-2">
            {/* Group avatar */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative w-20 h-20 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white flex items-center justify-center overflow-hidden hover:opacity-90"
              >
                {imageUrl
                  ? <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                  : <Users className="w-8 h-8" />}
                <span className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = '' }} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('group_name')} *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={t('group_name_ph')} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
            <Button onClick={() => setStep('members')} disabled={!name.trim()} className="w-full">
              {t('next')}
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mt-2">
              <Search className="w-4 h-4 text-gray-400 absolute start-3 top-1/2 -translate-y-1/2" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('chat_search_users')} className="ps-9" />
            </div>
            <p className="text-xs text-gray-500 mt-1">{selected.size} {t('members_selected')}</p>
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Array.from(selected).map(id => {
                  const u = allUsers.find(x => x.id === id)!
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
            <div className="mt-3 flex-1 overflow-y-auto space-y-1">
              {filtered.map(u => (
                <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-purple-600" />
                  <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-gray-500">{(u.full_name || u.email)[0].toUpperCase()}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setStep('details')} className="flex-1">{t('back')}</Button>
              <Button onClick={createGroup} disabled={creating || selected.size === 0} className="flex-1">
                {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('create')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
