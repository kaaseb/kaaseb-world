'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { toast } from 'sonner'
import { Building2, Calendar, Phone, GripVertical } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ClientProject, ClientProjectStatus } from '@/types'
import type { TranslationKey } from '@/lib/i18n/translations'
import { STATUS_OPTIONS, STATUS_COLORS } from './constants'

interface Props {
  projects: ClientProject[]
  onMove: (project: ClientProject, newStatus: ClientProjectStatus) => void
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

// Map status → tailwind background+text for the column header. Mirrors
// STATUS_COLORS but tuned for a wider column band.
const COLUMN_TONES: Record<ClientProjectStatus, string> = {
  new:                'border-blue-300 bg-blue-50/40',
  in_progress:        'border-amber-300 bg-amber-50/40',
  ready_to_send:      'border-indigo-300 bg-indigo-50/40',
  awaiting_reply:     'border-purple-300 bg-purple-50/40',
  updates_requested:  'border-orange-300 bg-orange-50/40',
  rejected:           'border-red-300 bg-red-50/40',
  completed:          'border-emerald-300 bg-emerald-50/40',
}

export function ClientProjectsKanban({ projects, onMove }: Props) {
  const { t, isRtl } = useLanguage()

  // Group locally so we don't lose responsiveness while the PATCH is
  // in-flight. The parent updates `projects` once the API resolves and the
  // grouping recomputes.
  const grouped = useMemo(() => {
    const map: Record<ClientProjectStatus, ClientProject[]> = {
      new: [], in_progress: [], ready_to_send: [], awaiting_reply: [],
      updates_requested: [], rejected: [], completed: [],
    }
    for (const p of projects) {
      const status = (map[p.status] ? p.status : 'new') as ClientProjectStatus
      map[status].push(p)
    }
    return map
  }, [projects])

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceStatus = result.source.droppableId as ClientProjectStatus
    const destStatus   = result.destination.droppableId as ClientProjectStatus
    if (sourceStatus === destStatus) return

    const project = grouped[sourceStatus][result.source.index]
    if (!project) return
    onMove(project, destStatus)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4" dir={isRtl ? 'rtl' : 'ltr'}>
        {STATUS_OPTIONS.map(opt => {
          const list = grouped[opt.value] || []
          return (
            <Droppable key={opt.value} droppableId={opt.value}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`flex-shrink-0 w-72 rounded-xl border-2 ${COLUMN_TONES[opt.value]} ${
                    snapshot.isDraggingOver ? 'ring-2 ring-primary/30' : ''
                  }`}
                >
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b border-current/10 flex items-center justify-between">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_COLORS[opt.value]}`}>
                      {t(opt.key as TranslationKey)}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground bg-background px-1.5 py-0.5 rounded">
                      {list.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="p-2 space-y-2 min-h-[80px]">
                    {list.map((p, idx) => (
                      <Draggable key={p.id} draggableId={p.id} index={idx}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            className={`bg-white rounded-lg border shadow-sm hover:shadow transition ${
                              snap.isDragging ? 'shadow-lg ring-2 ring-primary/40 rotate-1' : ''
                            }`}
                          >
                            <div className="p-3 space-y-2">
                              <div className="flex items-start gap-1.5">
                                <span
                                  {...prov.dragHandleProps}
                                  className="text-muted-foreground mt-0.5 cursor-grab active:cursor-grabbing"
                                  title="Drag"
                                >
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                <Link
                                  href={`/projects/${p.id}`}
                                  className="text-sm font-semibold hover:underline flex-1 min-w-0"
                                >
                                  {display(p.name_en, p.name_ar, isRtl)}
                                </Link>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-0.5 pl-5">
                                {(p.company_en || p.company_ar) && (
                                  <div className="flex items-center gap-1">
                                    <Building2 className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{display(p.company_en, p.company_ar, isRtl)}</span>
                                  </div>
                                )}
                                {p.engineer_phone && (
                                  <div className="flex items-center gap-1" dir="ltr">
                                    <Phone className="w-3 h-3 flex-shrink-0" />
                                    {p.engineer_phone}
                                  </div>
                                )}
                                {p.end_date && (
                                  <div className="flex items-center gap-1" dir="ltr">
                                    <Calendar className="w-3 h-3 flex-shrink-0" />
                                    {new Date(p.end_date).toLocaleDateString('en-GB')}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {list.length === 0 && !snapshot.isDraggingOver && (
                      <div className="text-center text-xs text-muted-foreground/50 py-6">
                        —
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Droppable>
          )
        })}
      </div>
    </DragDropContext>
  )
}

// Helper for the parent — does the optimistic update + PATCH + toast.
export async function patchClientProjectStatus(
  project: ClientProject,
  newStatus: ClientProjectStatus,
  t: (k: TranslationKey) => string,
): Promise<ClientProject | null> {
  try {
    const res = await fetch(`/api/client-projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    const j = await res.json()
    if (!res.ok) {
      toast.error(j.error || 'Failed')
      return null
    }
    toast.success(t('saved'))
    return j.project as ClientProject
  } catch (e) {
    toast.error(String(e))
    return null
  }
}
