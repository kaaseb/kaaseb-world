'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Lightbulb, Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Idea, Profile } from '@/types'

type IdeaWithAuthor = Idea & {
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  departments?: { id: string; name: string } | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  existingCategories: string[]
  departments: { id: string; name: string }[]
  onCreated: (idea: IdeaWithAuthor) => void
}

export function NewIdeaDialog({ open, onOpenChange, userId, existingCategories, departments, onCreated }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [newCategory, setNewCategory] = useState(false)
  const [departmentId, setDepartmentId] = useState<string>('') // '' = general
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle(''); setDescription(''); setCategory(''); setNewCategory(false); setDepartmentId('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('ideas')
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        department_id: departmentId || null,
        created_by: userId,
      })
      .select('*, profiles:created_by(id, full_name, email, avatar_url), departments(id, name)')
      .single()
    if (error) { toast.error(error.message); setSaving(false); return }
    onCreated(data as IdeaWithAuthor)
    toast.success(t('idea_posted'))
    reset()
    onOpenChange(false)
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-500" />
            {t('idea_new')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>{t('idea_title')} *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('idea_title_ph')} required autoFocus maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('description')}</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('idea_desc_ph')} rows={5} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('idea_category')}</Label>
            {newCategory || existingCategories.length === 0 ? (
              <div className="flex gap-2">
                <Input value={category} onChange={e => setCategory(e.target.value)} placeholder={t('idea_category_ph')} />
                {existingCategories.length > 0 && (
                  <Button type="button" variant="outline" onClick={() => { setNewCategory(false); setCategory('') }}>
                    {t('back')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">— {t('idea_category_none')} —</option>
                  {existingCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button type="button" variant="outline" onClick={() => { setNewCategory(true); setCategory('') }}>
                  {t('idea_new_category')}
                </Button>
              </div>
            )}
          </div>

          {/* Department (required concept: general OR a specific department) */}
          <div className="space-y-1.5">
            <Label>{t('idea_target_department')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDepartmentId('')}
                className={`p-2.5 rounded-lg border text-sm font-medium text-start transition-colors ${
                  departmentId === ''
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  🌐 {t('idea_general')}
                </span>
              </button>
              {departments.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDepartmentId(d.id)}
                  className={`p-2.5 rounded-lg border text-sm font-medium text-start transition-colors ${
                    departmentId === d.id
                      ? 'border-purple-400 bg-purple-50 text-purple-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    🏢 <span className="truncate">{d.name}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">{t('idea_target_department_hint')}</p>
          </div>

          <Button type="submit" disabled={saving || !title.trim()} className="w-full">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : <><Lightbulb className="w-4 h-4 mr-2" />{t('idea_submit')}</>}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
