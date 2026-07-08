'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Plus, X, Image as ImageIcon, Loader2, Trash2, Tag, Globe2, UserCheck, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useLanguage } from '@/contexts/LanguageContext'
import type { DepartmentDoodle, Profile } from '@/types'

type DoodleWithAuthor = DepartmentDoodle & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
}

interface Props {
  departmentId: string
  currentUserId: string
  isSuperAdmin: boolean
  // Members are scoped to the department; we also accept the full user list
  // so admins can grant visibility to people outside the department too.
  members: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  allUsers: Partial<Profile>[]
}

export function DoodlesTab({ departmentId, currentUserId, isSuperAdmin, members, allUsers }: Props) {
  const { t, isRtl } = useLanguage()
  const supabase = createClient()
  const [doodles, setDoodles] = useState<DoodleWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [viewing, setViewing] = useState<DoodleWithAuthor | null>(null)
  const [editing, setEditing] = useState<DoodleWithAuthor | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('department_doodles')
        .select('*, profiles:created_by(id, full_name, email, avatar_url)')
        .eq('department_id', departmentId)
        .order('created_at', { ascending: false })
      if (active) {
        setDoodles((data || []) as DoodleWithAuthor[])
        setLoading(false)
      }
    })()
    return () => { active = false }
  }, [departmentId, supabase])

  function handleCreated(doodle: DoodleWithAuthor) {
    setDoodles(prev => [doodle, ...prev])
  }

  function handleUpdated(doodle: DoodleWithAuthor) {
    setDoodles(prev => prev.map(d => d.id === doodle.id ? doodle : d))
    if (viewing?.id === doodle.id) setViewing(doodle)
  }

  async function handleDelete(id: string) {
    if (!confirm(t('doodle_confirm_delete'))) return
    const { error } = await supabase.from('department_doodles').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setDoodles(prev => prev.filter(d => d.id !== id))
    if (viewing?.id === id) setViewing(null)
    toast.success(t('doodle_deleted'))
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      <div className={`flex items-center justify-between mb-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{t('dept_doodles')}</h2>
          <p className="text-xs text-gray-500 mt-1">{t('dept_doodles_hint')}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
            <Plus className="w-4 h-4" />
            {t('doodle_new')}
          </DialogTrigger>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('doodle_new')}</DialogTitle>
            </DialogHeader>
            <DoodleForm
              departmentId={departmentId}
              currentUserId={currentUserId}
              members={members}
              allUsers={allUsers}
              onSaved={(d) => { handleCreated(d); setCreateOpen(false) }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t('loading')}</div>
      ) : doodles.length === 0 ? (
        <div className="text-center py-16 bg-gray-50/40 rounded-2xl border border-dashed border-gray-200">
          <ImageIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">{t('dept_doodles_empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {doodles.map(d => (
            <button
              key={d.id}
              onClick={() => setViewing(d)}
              className="group text-start bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all"
            >
              {d.image_url ? (
                <div className="aspect-video bg-gray-50 overflow-hidden">
                  <img src={d.image_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </div>
              ) : (
                <div className="aspect-video bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 flex items-center justify-center">
                  <span className="text-4xl">✏️</span>
                </div>
              )}
              <div className="p-3">
                <h3 className="text-sm font-semibold text-gray-900 line-clamp-1">{d.title}</h3>
                {d.description && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.description}</p>
                )}
                {d.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {d.categories.slice(0, 3).map(c => (
                      <span key={c} className="inline-flex items-center text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-1.5 py-0.5">
                        {c}
                      </span>
                    ))}
                    {d.categories.length > 3 && (
                      <span className="text-[10px] text-gray-400">+{d.categories.length - 3}</span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 text-[11px] text-gray-400">
                  <span className="truncate max-w-[60%]">
                    {d.profiles?.full_name || d.profiles?.email?.split('@')[0] || '—'}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    {d.visibility === 'everyone'
                      ? <><Globe2 className="w-3 h-3" /> {t('doodle_vis_everyone')}</>
                      : <><UserCheck className="w-3 h-3" /> {t('doodle_vis_specific')}</>}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('doodle_edit')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <DoodleForm
              key={editing.id}
              departmentId={departmentId}
              currentUserId={currentUserId}
              members={members}
              allUsers={allUsers}
              existing={editing}
              onSaved={(d) => { handleUpdated(d); setEditing(null) }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.title}</DialogTitle>
              </DialogHeader>
              {viewing.image_url && (
                <img src={viewing.image_url} alt="" className="w-full rounded-xl border border-gray-100 mb-4" />
              )}
              {viewing.description && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{viewing.description}</p>
              )}
              {viewing.categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {viewing.categories.map(c => (
                    <span key={c} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                      <Tag className="w-3 h-3" />{c}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
                <span>
                  {viewing.profiles?.full_name || viewing.profiles?.email?.split('@')[0] || '—'}
                  {' · '}
                  <span suppressHydrationWarning>
                    {new Date(viewing.created_at).toLocaleDateString(isRtl ? 'ar-SA' : 'en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </span>
                </span>
                {(viewing.created_by === currentUserId || isSuperAdmin) && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setEditing(viewing); setViewing(null) }}
                      className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(viewing.id)}
                      className="inline-flex items-center gap-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('delete')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Form is split out so the parent dialog can mount/unmount it cleanly.
// Used for both create and edit — when `existing` is passed, the form starts
// pre-filled and the submit calls UPDATE instead of INSERT.
function DoodleForm({
  departmentId, currentUserId, members, allUsers, existing, onSaved,
}: {
  departmentId: string
  currentUserId: string
  members: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  allUsers: Partial<Profile>[]
  existing?: DoodleWithAuthor
  onSaved: (d: DoodleWithAuthor) => void
}) {
  const { t } = useLanguage()
  const supabase = createClient()
  const isEdit = !!existing
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [categoriesInput, setCategoriesInput] = useState('')
  const [categories, setCategories] = useState<string[]>(existing?.categories ?? [])
  const [visibility, setVisibility] = useState<'everyone' | 'specific'>(existing?.visibility ?? 'everyone')
  const [visibleTo, setVisibleTo] = useState<string[]>(existing?.visible_to ?? [])
  const fileRef = useRef<HTMLInputElement>(null)

  // Combined people list for visibility selector — department members first
  // (most likely targets), then anyone else.
  const memberIds = new Set(members.map(m => m.id))
  const visibilityCandidates = [
    ...members,
    ...allUsers.filter(u => u.id && !memberIds.has(u.id)) as Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[],
  ]

  async function handleUpload(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'doodles')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (result.url) setImageUrl(result.url)
    else toast.error(result.error || 'Upload failed')
    setUploading(false)
  }

  function addCategory() {
    const v = categoriesInput.trim()
    if (!v) return
    if (!categories.includes(v)) setCategories(prev => [...prev, v])
    setCategoriesInput('')
  }

  function removeCategory(c: string) {
    setCategories(prev => prev.filter(x => x !== c))
  }

  function toggleVisibleUser(id: string) {
    setVisibleTo(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error(t('doodle_title_required')); return }
    if (visibility === 'specific' && visibleTo.length === 0) {
      toast.error(t('doodle_specific_required'))
      return
    }

    setSaving(true)
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      image_url: imageUrl,
      categories,
      visibility,
      visible_to: visibility === 'specific' ? visibleTo : [],
    }
    const query = isEdit
      ? supabase.from('department_doodles').update(payload).eq('id', existing!.id)
      : supabase.from('department_doodles').insert({
          ...payload,
          department_id: departmentId,
          created_by: currentUserId,
        })
    const { data, error } = await query
      .select('*, profiles:created_by(id, full_name, email, avatar_url)')
      .single()

    setSaving(false)
    if (error) { toast.error(error.message); return }
    onSaved(data as DoodleWithAuthor)
    toast.success(t(isEdit ? 'doodle_updated' : 'doodle_created'))
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Image */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('doodle_image')}</label>
        {imageUrl ? (
          <div className="relative rounded-lg overflow-hidden border border-gray-100">
            <img src={imageUrl} alt="" className="w-full max-h-64 object-cover" />
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              className="absolute top-2 end-2 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full h-32 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-500 disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <><ImageIcon className="w-5 h-5" /><span className="text-xs">{t('doodle_image_pick')}</span></>}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }}
        />
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('doodle_title')} *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('doodle_title_ph')}
          className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          maxLength={120}
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('doodle_description')}</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('doodle_description_ph')}
          rows={4}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
        />
      </div>

      {/* Categories */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('doodle_categories')}</label>
        <div className="flex gap-2">
          <input
            value={categoriesInput}
            onChange={e => setCategoriesInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
            placeholder={t('doodle_category_ph')}
            className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          />
          <button
            type="button"
            onClick={addCategory}
            disabled={!categoriesInput.trim()}
            className="px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {categories.map(c => (
              <span key={c} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                {c}
                <button type="button" onClick={() => removeCategory(c)} className="hover:text-red-600">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Visibility */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('doodle_visibility')}</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setVisibility('everyone')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              visibility === 'everyone'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Globe2 className="w-4 h-4" />
            {t('doodle_vis_everyone')}
          </button>
          <button
            type="button"
            onClick={() => setVisibility('specific')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              visibility === 'specific'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            {t('doodle_vis_specific')}
          </button>
        </div>

        {visibility === 'specific' && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-gray-100 p-2 space-y-1">
            {visibilityCandidates.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">{t('doodle_no_users')}</p>
            ) : (
              visibilityCandidates.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleTo.includes(u.id!)}
                    onChange={() => toggleVisibleUser(u.id!)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <div className="w-6 h-6 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[10px] font-bold leading-6 block text-center text-gray-500">{(u.full_name || u.email || 'U')[0]?.toUpperCase()}</span>}
                  </div>
                  <span className="text-xs text-gray-700 flex-1 truncate">{u.full_name || u.email}</span>
                </label>
              ))
            )}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="w-full h-10 rounded-lg bg-gray-900 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-gray-800 transition-colors"
      >
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : isEdit
            ? <Pencil className="w-4 h-4" />
            : <Plus className="w-4 h-4" />}
        {isEdit ? t('doodle_save') : t('doodle_create')}
      </button>
    </form>
  )
}
