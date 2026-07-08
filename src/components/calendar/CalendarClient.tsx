'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, MapPin, Globe2,
  Users as UsersIcon, Building2, Target, FolderKanban, Trash2, Pencil,
  ExternalLink, Check, Clock,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLanguage } from '@/contexts/LanguageContext'
import type {
  EventPriority, EventAttendeeStatus, Profile,
} from '@/types'
import { EventForm, type EventWithLinks } from './EventForm'

type Dept = { id: string; name: string }
type Goal = { id: string; title: string; department_id: string | null }
type Project = { id: string; name: string; department_id: string | null }
// Concrete attendee shape used inside the detail sidebar — required fields
// only appear after the row has been fetched/written, so we narrow there.
type Attendee = { user_id: string; status: EventAttendeeStatus; awarded_points: number; marked_by: string | null; marked_at: string | null }

interface Props {
  profile: Profile
  events: EventWithLinks[]
  departments: Dept[]
  goals: Goal[]
  projects: Project[]
  users: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'role'>[]
}

const PRIORITY_BG: Record<EventPriority, string> = {
  urgent: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  high:   'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  low:    'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
}
const PRIORITY_DOT: Record<EventPriority, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-500',
  medium: 'bg-blue-500',
  low:    'bg-gray-400',
}

export function CalendarClient({ profile, events: initialEvents, departments, goals, projects, users }: Props) {
  const { t, isRtl, lang } = useLanguage()
  const supabase = createClient()
  const isSuperAdmin = profile.role === 'super_admin'

  const [events, setEvents] = useState(initialEvents)
  const today = new Date()
  // The visible month is tracked as (year, monthIndex 0-11). Default = today.
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const [createOpen, setCreateOpen] = useState(false)
  const [createForDate, setCreateForDate] = useState<string | null>(null)
  const [editing, setEditing] = useState<EventWithLinks | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedEvent = useMemo(() => events.find(e => e.id === selectedId) ?? null, [events, selectedId])

  // ─── Build the day grid ──────────────────────────────────────────────────
  // Saturday-first when locale is Arabic; Sunday-first otherwise. We always
  // emit a 6×7 grid (42 cells) to keep the layout from jumping when a month
  // straddles 5 vs 6 weeks.
  const weekStartsOn = lang === 'ar' ? 6 : 0  // 6 = Saturday
  const grid = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1)
    const lastOfMonth = new Date(year, month + 1, 0)
    const firstWeekday = firstOfMonth.getDay()
    // Days to back-fill from the previous month so the week starts cleanly.
    const lead = (firstWeekday - weekStartsOn + 7) % 7
    const start = new Date(year, month, 1 - lead)
    const cells: Date[] = []
    for (let i = 0; i < 42; i++) {
      cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
    }
    return { cells, firstOfMonth, lastOfMonth }
  }, [year, month, weekStartsOn])

  // Bucket events by YYYY-MM-DD for O(1) lookup per cell.
  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventWithLinks[]>()
    for (const e of events) {
      if (!map.has(e.event_date)) map.set(e.event_date, [])
      map.get(e.event_date)!.push(e)
    }
    return map
  }, [events])

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function navigate(delta: number) {
    const next = new Date(year, month + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth())
  }

  function goToToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  // ─── Mutations ───────────────────────────────────────────────────────────
  function handleSaved(e: EventWithLinks) {
    setEvents(prev => {
      const idx = prev.findIndex(x => x.id === e.id)
      if (idx === -1) return [...prev, e]
      const next = [...prev]
      next[idx] = e
      return next
    })
    setCreateOpen(false)
    setEditing(null)
    setSelectedId(e.id)
  }

  async function handleDelete(eventId: string) {
    if (!confirm(t('calendar_confirm_delete'))) return
    const { error } = await supabase.from('events').delete().eq('id', eventId)
    if (error) { toast.error(error.message); return }
    setEvents(prev => prev.filter(e => e.id !== eventId))
    setSelectedId(null)
    toast.success(t('calendar_event_deleted'))
  }

  // Mark attendance for one user; super_admin only. Awards/deducts points
  // per the event's mode and value.
  async function setAttendance(eventId: string, userId: string, status: EventAttendeeStatus) {
    const ev = events.find(e => e.id === eventId)
    if (!ev) return
    let delta = 0
    if (ev.attendance_mode === 'attendance' && status === 'attended') delta = ev.attendance_points
    else if (ev.attendance_mode === 'absence' && status === 'absent') delta = -ev.attendance_points

    const { error } = await supabase.from('event_attendees').update({
      status, awarded_points: delta, marked_by: profile.id, marked_at: new Date().toISOString(),
    }).eq('event_id', eventId).eq('user_id', userId)
    if (error) { toast.error(error.message); return }

    setEvents(prev => prev.map(e => {
      if (e.id !== eventId) return e
      return {
        ...e,
        event_attendees: (e.event_attendees ?? []).map(a => a.user_id === userId
          ? { ...a, status, awarded_points: delta, marked_by: profile.id, marked_at: new Date().toISOString() }
          : a),
      }
    }))

    // Award/deduct from the user's total_points so the leaderboard reflects
    // attendance. We update by reading current value then writing back —
    // simple and good enough; concurrent attendance marking is rare.
    if (delta !== 0) {
      const { data: cur } = await supabase.from('profiles').select('total_points').eq('id', userId).single()
      if (cur) {
        await supabase.from('profiles')
          .update({ total_points: (cur.total_points ?? 0) + delta })
          .eq('id', userId)
      }
    }
    toast.success(t('calendar_attendance_recorded'))
  }

  const monthLabel = grid.firstOfMonth.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'long', year: 'numeric' })

  // Day-of-week labels in local order, starting from `weekStartsOn`.
  const weekLabels = useMemo(() => {
    const base = new Date(2024, 0, 7 + weekStartsOn) // Jan 7 2024 was a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
      return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { weekday: 'short' })
    })
  }, [weekStartsOn, lang])

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-7 h-7 text-indigo-500" />
            {t('calendar_title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('calendar_subtitle')}</p>
        </div>
        <button
          onClick={() => { setCreateForDate(null); setCreateOpen(true) }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('calendar_new_event')}
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label={t('calendar_prev_month')}
          >
            {isRtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <span className="text-base font-semibold text-gray-900 min-w-[160px] text-center" suppressHydrationWarning>
            {monthLabel}
          </span>
          <button
            onClick={() => navigate(1)}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label={t('calendar_next_month')}
          >
            {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={goToToday}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          {t('calendar_today')}
        </button>
      </div>

      {/* Week labels */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekLabels.map((wd, i) => (
          <div key={i} className="text-center text-[11px] font-semibold text-gray-500 py-1">{wd}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {grid.cells.map((d, i) => {
          const inMonth = d.getMonth() === month
          const isToday = dateKey(d) === dateKey(today)
          const dayEvents = eventsByDate.get(dateKey(d)) ?? []
          return (
            <button
              key={i}
              onClick={() => { setCreateForDate(dateKey(d)); setCreateOpen(true) }}
              className={`min-h-[96px] rounded-lg border p-1.5 text-start transition-colors ${
                inMonth
                  ? 'bg-white border-gray-100 hover:border-gray-200'
                  : 'bg-gray-50/50 border-gray-50 text-gray-400'
              } ${isToday ? '!border-indigo-300 ring-1 ring-indigo-200' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-bold ${isToday ? 'text-indigo-600' : inMonth ? 'text-gray-700' : 'text-gray-400'}`}>
                  {d.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className="text-[10px] font-semibold text-gray-400">{dayEvents.length}</span>
                )}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map(e => (
                  <div
                    key={e.id}
                    onClick={(ev) => { ev.stopPropagation(); setSelectedId(e.id) }}
                    className={`text-[11px] truncate rounded px-1.5 py-0.5 font-medium cursor-pointer ${PRIORITY_BG[e.priority]}`}
                  >
                    {e.event_time && <span className="opacity-70 me-1">{e.event_time.slice(0, 5)}</span>}
                    {e.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-gray-500 ps-1">+{dayEvents.length - 3} {t('calendar_more_events')}</div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('calendar_new_event')}</DialogTitle>
          </DialogHeader>
          <EventForm
            profile={profile}
            initialDate={createForDate ?? undefined}
            departments={departments}
            goals={goals}
            projects={projects}
            users={users}
            onSaved={handleSaved}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('calendar_save')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <EventForm
              key={editing.id}
              profile={profile}
              existing={editing}
              departments={departments}
              goals={goals}
              projects={projects}
              users={users}
              onSaved={handleSaved}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Detail sidebar */}
      {selectedEvent && (
        <EventDetailSidebar
          event={selectedEvent}
          isSuperAdmin={isSuperAdmin}
          isOwner={selectedEvent.created_by === profile.id}
          departments={departments}
          goals={goals}
          projects={projects}
          users={users}
          isRtl={isRtl}
          onClose={() => setSelectedId(null)}
          onEdit={() => { setEditing(selectedEvent); setSelectedId(null) }}
          onDelete={() => handleDelete(selectedEvent.id)}
          onMarkAttendance={(uid, status) => setAttendance(selectedEvent.id, uid, status)}
        />
      )}
    </div>
  )
}

// ─── Detail sidebar ────────────────────────────────────────────────────────
function EventDetailSidebar({
  event, isSuperAdmin, isOwner, departments, goals, projects, users, isRtl,
  onClose, onEdit, onDelete, onMarkAttendance,
}: {
  event: EventWithLinks
  isSuperAdmin: boolean
  isOwner: boolean
  departments: Dept[]
  goals: Goal[]
  projects: Project[]
  users: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'role'>[]
  isRtl: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onMarkAttendance: (userId: string, status: EventAttendeeStatus) => void
}) {
  const { t, lang } = useLanguage()

  // Resolve linked entity rows for display. Junction arrays are optional on
  // the loose EventWithLinks type; default to [] so map() is always safe.
  const linkedDepts = (event.event_departments ?? [])
    .map(d => departments.find(x => x.id === d.department_id))
    .filter(Boolean) as Dept[]
  const linkedGoals = (event.event_goals ?? [])
    .map(g => goals.find(x => x.id === g.goal_id))
    .filter(Boolean) as Goal[]
  const linkedProjects = (event.event_projects ?? [])
    .map(p => projects.find(x => x.id === p.project_id))
    .filter(Boolean) as Project[]
  const linkedAttendees = (event.event_attendees ?? []).map(a => ({
    user_id: a.user_id,
    status: (a.status ?? 'invited') as EventAttendeeStatus,
    awarded_points: a.awarded_points ?? 0,
    profile: users.find(u => u.id === a.user_id),
  })).filter(a => a.profile)

  const dateLabel = new Date(event.event_date + 'T00:00:00').toLocaleDateString(
    lang === 'ar' ? 'ar-SA' : 'en-US',
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  )

  const canManageEvent = isSuperAdmin || isOwner

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-40" />
      <aside
        dir={isRtl ? 'rtl' : 'ltr'}
        className={`fixed top-0 ${isRtl ? 'left-0 border-r' : 'right-0 border-l'} bottom-0 w-full sm:w-[420px] bg-white border-gray-100 z-50 overflow-y-auto overscroll-contain`}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[event.priority]}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${PRIORITY_BG[event.priority]}`}>
                  {t(`calendar_priority_${event.priority}` as 'calendar_priority_low')}
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">{event.title}</h2>
              <p className="text-sm text-gray-500 mt-1" suppressHydrationWarning>
                {dateLabel}{event.event_time && ` · ${event.event_time.slice(0, 5)}`}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {event.description && (
            <p className="text-sm text-gray-700 mb-4 whitespace-pre-wrap leading-relaxed">{event.description}</p>
          )}

          {/* Location */}
          <Section icon={event.location_type === 'online' ? <Globe2 className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}>
            {event.location_type === 'online' ? (
              event.meeting_url ? (
                <a href={event.meeting_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
                  {t('calendar_open_meet')}<ExternalLink className="w-3 h-3" />
                </a>
              ) : <span className="text-sm text-gray-500">{t('calendar_location_online')}</span>
            ) : (
              <span className="text-sm text-gray-700">{event.location || t('calendar_location_in_person')}</span>
            )}
          </Section>

          {/* Departments */}
          <Section icon={<Building2 className="w-4 h-4" />} label={t('calendar_departments')}>
            {linkedDepts.length === 0 ? (
              <span className="text-xs text-gray-500">{t('calendar_all_departments')}</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {linkedDepts.map(d => <Chip key={d.id} label={d.name} />)}
              </div>
            )}
          </Section>

          {/* Goals */}
          {linkedGoals.length > 0 && (
            <Section icon={<Target className="w-4 h-4" />} label={t('calendar_goals')}>
              <div className="flex flex-wrap gap-1">
                {linkedGoals.map(g => <Chip key={g.id} label={g.title} />)}
              </div>
            </Section>
          )}

          {/* Projects */}
          {linkedProjects.length > 0 && (
            <Section icon={<FolderKanban className="w-4 h-4" />} label={t('calendar_projects')}>
              <div className="flex flex-wrap gap-1">
                {linkedProjects.map(p => <Chip key={p.id} label={p.name} />)}
              </div>
            </Section>
          )}

          {/* Attendees */}
          <Section icon={<UsersIcon className="w-4 h-4" />} label={`${t('calendar_attendees')} (${linkedAttendees.length})`}>
            {linkedAttendees.length === 0 ? (
              <span className="text-xs text-gray-500">{t('calendar_no_attendees')}</span>
            ) : (
              <ul className="space-y-1.5">
                {linkedAttendees.map(a => (
                  <li key={a.user_id} className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
                      {a.profile?.avatar_url
                        ? <img src={a.profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <span className="text-[10px] font-bold leading-7 block text-center text-gray-500">{(a.profile?.full_name || a.profile?.email || 'U')[0]?.toUpperCase()}</span>}
                    </div>
                    <span className="text-sm text-gray-800 flex-1 truncate">{a.profile?.full_name || a.profile?.email}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      a.status === 'attended' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : a.status === 'absent' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300'
                    }`}>
                      {t(`calendar_status_${a.status}` as 'calendar_status_invited')}
                    </span>
                    {isSuperAdmin && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => onMarkAttendance(a.user_id, 'attended')}
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                          title={t('calendar_mark_attended')}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onMarkAttendance(a.user_id, 'absent')}
                          className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                          title={t('calendar_mark_absent')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Footer */}
          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('calendar_created_by')} {event.creator?.full_name || event.creator?.email?.split('@')[0] || '—'}
            </span>
            {canManageEvent && (
              <div className="flex items-center gap-2">
                <button onClick={onEdit} className="inline-flex items-center gap-1 text-gray-700 hover:text-gray-900">
                  <Pencil className="w-3.5 h-3.5" />
                  {t('edit')}
                </button>
                <button onClick={onDelete} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700">
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('delete')}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

function Section({ icon, label, children }: { icon: React.ReactNode; label?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 pb-3 border-b border-gray-100">
      <div className="flex items-center gap-2 mb-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
        {icon}
        {label && <span>{label}</span>}
      </div>
      {children}
    </div>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-xs font-medium text-gray-700 bg-gray-100 dark:bg-white/10 dark:text-gray-200 rounded-full px-2 py-0.5">
      {label}
    </span>
  )
}
