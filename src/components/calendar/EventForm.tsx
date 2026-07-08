'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Loader2, Plus, Globe2, MapPin, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/LanguageContext'
import type {
  CalendarEvent, EventPriority, EventAttendanceMode, EventLocationType, Profile,
} from '@/types'

type Dept = { id: string; name: string }
type Goal = { id: string; title: string; department_id: string | null }
type Project = { id: string; name: string; department_id: string | null }
// Loose links type — accepts whatever shape the parent passes (the parent's
// fully-hydrated rows have extra fields we just don't read here).
export type EventWithLinks = CalendarEvent & {
  creator?: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  event_departments?: { department_id: string }[]
  event_goals?: { goal_id: string }[]
  event_projects?: { project_id: string }[]
  event_attendees?: { user_id: string; status?: string; awarded_points?: number; marked_by?: string | null; marked_at?: string | null }[]
}

interface Props {
  profile: Profile
  existing?: EventWithLinks
  initialDate?: string
  departments: Dept[]
  goals: Goal[]
  projects: Project[]
  users: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'>[]
  // The page also needs department_members to know which employees belong to
  // which department; we resolve that with a single membership map fetched
  // on first mount (one extra query per dialog open is fine).
  onSaved: (e: EventWithLinks) => void
  onCancel: () => void
}

export function EventForm({
  profile, existing, initialDate, departments, goals, projects, users, onSaved, onCancel,
}: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const isEdit = !!existing

  // ─── Field state ─────────────────────────────────────────────────────────
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [priority, setPriority] = useState<EventPriority>(existing?.priority ?? 'medium')
  const [attendanceMode, setAttendanceMode] = useState<EventAttendanceMode>(existing?.attendance_mode ?? 'manual')
  const [attendancePoints, setAttendancePoints] = useState<number>(existing?.attendance_points ?? 0)
  const [locationType, setLocationType] = useState<EventLocationType>(existing?.location_type ?? 'in_person')
  const [meetingUrl, setMeetingUrl] = useState(existing?.meeting_url ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [eventDate, setEventDate] = useState(existing?.event_date ?? initialDate ?? new Date().toISOString().slice(0, 10))
  const [eventTime, setEventTime] = useState(existing?.event_time ?? '')

  // Multi-selects: empty deptIds = "all departments" (matches the DB
  // convention where an empty event_departments junction means everyone).
  const [deptIds, setDeptIds] = useState<string[]>(existing?.event_departments?.map(d => d.department_id) ?? [])
  const [allDepts, setAllDepts] = useState(deptIds.length === 0)
  const [goalIds, setGoalIds] = useState<string[]>(existing?.event_goals?.map(g => g.goal_id) ?? [])
  const [projectIds, setProjectIds] = useState<string[]>(existing?.event_projects?.map(p => p.project_id) ?? [])
  const [attendeeIds, setAttendeeIds] = useState<string[]>(existing?.event_attendees?.map(a => a.user_id) ?? [])

  const [saving, setSaving] = useState(false)

  // Membership map: department_id → user_ids[]. Populated once on mount so
  // we can filter attendees by the chosen departments without re-fetching.
  const [memberMap, setMemberMap] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.from('department_members').select('department_id, user_id')
      if (!active) return
      const map: Record<string, string[]> = {}
      for (const row of data ?? []) {
        if (!map[row.department_id]) map[row.department_id] = []
        map[row.department_id].push(row.user_id)
      }
      setMemberMap(map)
    })()
    return () => { active = false }
  }, [supabase])

  // ─── Cascading filters ───────────────────────────────────────────────────
  // When "all departments" is checked we expose every project/goal/user;
  // otherwise we narrow to those tied to the chosen departments.
  const filteredProjects = useMemo(() => {
    if (allDepts || deptIds.length === 0) return projects
    const set = new Set(deptIds)
    return projects.filter(p => p.department_id && set.has(p.department_id))
  }, [projects, deptIds, allDepts])

  const filteredGoals = useMemo(() => {
    if (allDepts || deptIds.length === 0) return goals
    const set = new Set(deptIds)
    return goals.filter(g => g.department_id && set.has(g.department_id))
  }, [goals, deptIds, allDepts])

  const filteredUsers = useMemo(() => {
    if (allDepts || deptIds.length === 0) return users
    const allowed = new Set<string>()
    for (const d of deptIds) {
      for (const u of (memberMap[d] ?? [])) allowed.add(u)
    }
    return users.filter(u => allowed.has(u.id))
  }, [users, deptIds, allDepts, memberMap])

  // Whenever the department filter narrows, drop selections that fall
  // outside the new filter so we don't silently submit stale ids.
  useEffect(() => {
    setProjectIds(prev => prev.filter(id => filteredProjects.some(p => p.id === id)))
    setGoalIds(prev => prev.filter(id => filteredGoals.some(g => g.id === id)))
    setAttendeeIds(prev => prev.filter(id => filteredUsers.some(u => u.id === id)))
  }, [filteredProjects, filteredGoals, filteredUsers])

  // ─── Handlers ────────────────────────────────────────────────────────────
  function toggle<T extends string>(id: T, list: T[], setter: (next: T[]) => void) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !eventDate) { toast.error(t('calendar_event_required')); return }

    setSaving(true)
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      attendance_mode: attendanceMode,
      attendance_points: attendancePoints,
      location_type: locationType,
      meeting_url: locationType === 'online' ? (meetingUrl.trim() || null) : null,
      location: locationType === 'in_person' ? (location.trim() || null) : null,
      event_date: eventDate,
      event_time: eventTime || null,
    }

    let eventId = existing?.id ?? ''
    if (isEdit) {
      const { error } = await supabase.from('events').update(payload).eq('id', existing!.id)
      if (error) { toast.error(error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase
        .from('events')
        .insert({ ...payload, created_by: profile.id })
        .select('id')
        .single()
      if (error || !data) { toast.error(error?.message ?? 'failed'); setSaving(false); return }
      eventId = data.id
    }

    // Replace junctions wholesale — simpler than diffing for an event whose
    // membership lists are typically tiny.
    if (isEdit) {
      await Promise.all([
        supabase.from('event_departments').delete().eq('event_id', eventId),
        supabase.from('event_goals').delete().eq('event_id', eventId),
        supabase.from('event_projects').delete().eq('event_id', eventId),
        supabase.from('event_attendees').delete().eq('event_id', eventId),
      ])
    }

    const finalDeptIds = allDepts ? [] : deptIds
    // Supabase query builders are PromiseLike (not full Promise) until
    // awaited. Use PromiseLike[] so Promise.all accepts the .then() output.
    const inserts: PromiseLike<unknown>[] = []
    if (finalDeptIds.length) inserts.push(
      supabase.from('event_departments').insert(finalDeptIds.map(id => ({ event_id: eventId, department_id: id }))).then(r => r)
    )
    if (goalIds.length) inserts.push(
      supabase.from('event_goals').insert(goalIds.map(id => ({ event_id: eventId, goal_id: id }))).then(r => r)
    )
    if (projectIds.length) inserts.push(
      supabase.from('event_projects').insert(projectIds.map(id => ({ event_id: eventId, project_id: id }))).then(r => r)
    )
    if (attendeeIds.length) inserts.push(
      supabase.from('event_attendees').insert(attendeeIds.map(id => ({ event_id: eventId, user_id: id, status: 'invited' }))).then(r => r)
    )
    await Promise.all(inserts)

    // Re-fetch the canonical row so the parent UI sees up-to-date links.
    const { data: full } = await supabase
      .from('events')
      .select(`
        *,
        creator:created_by(id, full_name, email, avatar_url),
        event_departments(department_id),
        event_goals(goal_id),
        event_projects(project_id),
        event_attendees(user_id, status, awarded_points, marked_by, marked_at)
      `)
      .eq('id', eventId)
      .single()

    setSaving(false)
    if (full) onSaved(full as EventWithLinks)
    toast.success(t(isEdit ? 'calendar_event_updated' : 'calendar_event_created'))
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_event_name')} *</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('calendar_event_name_ph')}
          className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          maxLength={160}
          required
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_event_description')}</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('calendar_event_description_ph')}
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_event_date')} *</label>
          <input
            type="date"
            value={eventDate}
            onChange={e => setEventDate(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_event_time')}</label>
          <input
            type="time"
            value={eventTime}
            onChange={e => setEventTime(e.target.value)}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          />
        </div>
      </div>

      {/* Priority */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_priority')}</label>
        <div className="grid grid-cols-4 gap-2">
          {(['low', 'medium', 'high', 'urgent'] as EventPriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                priority === p
                  ? p === 'urgent' ? 'bg-red-600 text-white'
                  : p === 'high'   ? 'bg-orange-500 text-white'
                  : p === 'medium' ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(`calendar_priority_${p}` as 'calendar_priority_low')}
            </button>
          ))}
        </div>
      </div>

      {/* Attendance + points */}
      <div className="rounded-lg border border-gray-100 p-3">
        <label className="block text-xs font-semibold text-gray-700 mb-2">{t('calendar_attendance')}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          {(['attendance', 'absence', 'manual'] as EventAttendanceMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setAttendanceMode(m)}
              className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                attendanceMode === m
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t(`calendar_attendance_${m}` as 'calendar_attendance_manual')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{t('calendar_points_label')}:</span>
          <input
            type="number"
            min={0}
            value={attendancePoints}
            onChange={e => setAttendancePoints(Math.max(0, Number(e.target.value) || 0))}
            className="w-24 h-8 rounded-md border border-gray-200 px-2 text-sm outline-none focus:border-gray-400"
          />
        </div>
      </div>

      {/* Departments */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_departments')}</label>
        <label className="inline-flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            checked={allDepts}
            onChange={(e) => { setAllDepts(e.target.checked); if (e.target.checked) setDeptIds([]) }}
            className="w-4 h-4"
          />
          <span className="text-sm text-gray-700">{t('calendar_all_departments')}</span>
        </label>
        {!allDepts && (
          <div className="flex flex-wrap gap-1.5">
            {departments.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id, deptIds, setDeptIds)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                  deptIds.includes(d.id)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Linked goals */}
      <Picker
        label={t('calendar_goals')}
        emptyLabel={t('calendar_no_goals')}
        items={filteredGoals.map(g => ({ id: g.id, label: g.title }))}
        selected={goalIds}
        onToggle={(id) => toggle(id, goalIds, setGoalIds)}
      />

      {/* Linked projects */}
      <Picker
        label={t('calendar_projects')}
        emptyLabel={t('calendar_no_projects')}
        items={filteredProjects.map(p => ({ id: p.id, label: p.name }))}
        selected={projectIds}
        onToggle={(id) => toggle(id, projectIds, setProjectIds)}
      />

      {/* Attendees */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-700">{t('calendar_attendees')}</label>
          <div className="flex gap-2 text-[11px]">
            <button type="button" onClick={() => setAttendeeIds(filteredUsers.map(u => u.id))} className="text-blue-600 hover:underline">{t('calendar_select_all')}</button>
            <button type="button" onClick={() => setAttendeeIds([])} className="text-gray-500 hover:underline">{t('calendar_clear_all')}</button>
          </div>
        </div>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 p-2 space-y-1">
          {filteredUsers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">{t('calendar_no_attendees')}</p>
          ) : (
            filteredUsers.map(u => (
              <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(u.id)}
                  onChange={() => toggle(u.id, attendeeIds, setAttendeeIds)}
                  className="w-4 h-4"
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
      </div>

      {/* Location */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">{t('calendar_location_type')}</label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            onClick={() => setLocationType('online')}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              locationType === 'online' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Globe2 className="w-4 h-4" />
            {t('calendar_location_online')}
          </button>
          <button
            type="button"
            onClick={() => setLocationType('in_person')}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              locationType === 'in_person' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <MapPin className="w-4 h-4" />
            {t('calendar_location_in_person')}
          </button>
        </div>
        {locationType === 'online' ? (
          <input
            value={meetingUrl}
            onChange={e => setMeetingUrl(e.target.value)}
            placeholder={t('calendar_meeting_url_ph')}
            type="url"
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          />
        ) : (
          <input
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder={t('calendar_location_ph')}
            className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400"
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
        <Button type="submit" disabled={saving} className="bg-gray-900 hover:bg-gray-800 text-white">
          {saving
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</>
            : <><Plus className="w-4 h-4 mr-2" />{t(isEdit ? 'calendar_save' : 'calendar_create')}</>}
        </Button>
      </div>
    </form>
  )
}

// Reusable multi-select chip picker. Items render as toggle chips; selected
// items get a check icon and the dark fill state.
function Picker({
  label, emptyLabel, items, selected, onToggle,
}: {
  label: string
  emptyLabel: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map(it => {
            const isSel = selected.includes(it.id)
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onToggle(it.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isSel
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                }`}
              >
                {isSel ? <Check className="w-3 h-3" /> : null}
                {it.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Re-export X icon (used by parent for chip removal style consistency).
export { X as RemoveIcon }
