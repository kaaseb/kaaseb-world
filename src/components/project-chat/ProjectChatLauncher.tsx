'use client'

// Floating chat launcher, mounted app-wide. A hanging button opens a panel that
// lists the projects; picking one opens its team chat. Hidden entirely when the
// feature is turned off (super-admin toggle) or the user lacks project access.
//
// Mobile: the panel is full-screen (100dvh) so the on-screen keyboard never
// hides the composer. Desktop: a bottom-corner card.

import { useState, useEffect, useCallback } from 'react'
import { MessagesSquare, X, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'
import { ProjectChat } from './ProjectChat'

interface ProjectLite { id: string; name_ar: string | null; name_en: string | null; status?: string | null }

export function ProjectChatLauncher({ currentUser }: { currentUser: Profile }) {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const Back = isRtl ? ChevronRight : ChevronLeft

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectLite[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ProjectLite | null>(null)
  const [listTab, setListTab] = useState<'active' | 'completed'>('active')

  useEffect(() => {
    let alive = true
    fetch('/api/project-chat/settings')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => { if (alive) setEnabled(!!j.enabled) })
      .catch(() => { if (alive) setEnabled(false) })
    return () => { alive = false }
  }, [])

  const loadProjects = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/client-projects')
      const j = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(j.projects)) setProjects(j.projects as ProjectLite[])
    } catch { /* ignore */ } finally { setLoadingList(false); setLoaded(true) }
  }, [])

  useEffect(() => { if (open && !loaded) loadProjects() }, [open, loaded, loadProjects])

  if (enabled !== true) return null

  const name = (p: ProjectLite) => (ar ? (p.name_ar || p.name_en) : (p.name_en || p.name_ar)) || '—'
  const completed = projects.filter((p) => p.status === 'completed')
  const active = projects.filter((p) => p.status !== 'completed')
  const base = listTab === 'completed' ? completed : active
  const q = search.trim().toLowerCase()
  const filtered = q
    ? base.filter((p) => `${p.name_ar || ''} ${p.name_en || ''}`.toLowerCase().includes(q))
    : base

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed bottom-5 end-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          aria-label={ar ? 'دردشة المشاريع' : 'Project chat'}
          title={ar ? 'دردشة المشاريع' : 'Project chat'}
        >
          <MessagesSquare className="w-6 h-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className="fixed z-50 bg-white flex flex-col overflow-hidden inset-0 h-[100dvh] sm:inset-auto sm:bottom-5 sm:end-5 sm:h-[600px] sm:max-h-[85vh] sm:w-[400px] sm:rounded-2xl sm:shadow-2xl sm:border sm:border-gray-200"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 h-14 border-b bg-gradient-to-l from-blue-50 to-white flex-shrink-0">
            {selected ? (
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-600" aria-label={ar ? 'رجوع' : 'Back'}>
                <Back className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
                <MessagesSquare className="w-4 h-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {selected ? name(selected) : (ar ? 'دردشة المشاريع' : 'Project chats')}
              </p>
              {!selected && <p className="text-[11px] text-gray-500">{ar ? 'اختر مشروعاً للنقاش' : 'Pick a project to discuss'}</p>}
            </div>
            <button onClick={() => { setOpen(false) }} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500" aria-label={ar ? 'إغلاق' : 'Close'}>
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          {selected ? (
            <ProjectChat projectId={selected.id} currentUser={currentUser} />
          ) : (
            <div className="flex flex-col min-h-0 flex-1">
              <div className="px-2.5 pt-2.5 flex-shrink-0">
                <div className="inline-flex w-full rounded-lg bg-gray-100 p-0.5 text-xs">
                  <button
                    onClick={() => setListTab('active')}
                    className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors ${listTab === 'active' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                  >
                    {ar ? 'نشطة' : 'Active'} ({active.length})
                  </button>
                  <button
                    onClick={() => setListTab('completed')}
                    className={`flex-1 px-3 py-1.5 rounded-md font-medium transition-colors ${listTab === 'completed' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500'}`}
                  >
                    {ar ? 'مكتملة' : 'Completed'} ({completed.length})
                  </button>
                </div>
              </div>
              <div className="p-2.5 border-b flex-shrink-0">
                <div className="relative">
                  <Search className={`w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-3' : 'left-3'}`} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={ar ? 'ابحث عن مشروع…' : 'Search a project…'}
                    className={`w-full h-10 rounded-lg bg-gray-50 border border-transparent focus:border-blue-300 focus:bg-white text-sm outline-none ${isRtl ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {loadingList ? (
                  <div className="flex items-center justify-center h-full py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                ) : filtered.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-10">{ar ? 'لا مشاريع' : 'No projects'}</p>
                ) : (
                  <ul className="divide-y">
                    {filtered.map((p) => (
                      <li key={p.id}>
                        <button onClick={() => setSelected(p)} className="w-full text-start px-4 py-3 hover:bg-gray-50 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                            {(name(p)[0] || '؟').toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{name(p)}</span>
                          <Back className="w-4 h-4 text-gray-300 rotate-180" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
