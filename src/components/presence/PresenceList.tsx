'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLanguage } from '@/contexts/LanguageContext'
import { Users, Clock } from 'lucide-react'

interface Member {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
  title: string | null
  last_seen_at: string
}

interface Props {
  currentUserId: string
}

// "online" = last heartbeat ≤ 3 min ago. The heartbeat ticks every 60s while
// the tab is visible, so 3 min covers a brief window switch / network hiccup
// without flickering people offline.
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000
// Hide users idle longer than this from the "Last seen" list so the widget
// doesn't accumulate ghosts.
const RECENT_WINDOW_MS    = 30 * 24 * 60 * 60_000
const REFRESH_MS          = 60_000
const MAX_PER_SECTION     = 30

function timeAgoShort(iso: string, lang: 'en' | 'ar'): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (lang === 'ar') {
    if (m < 1) return 'الآن'
    if (m < 60) return `${m} د`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} س`
    const d = Math.floor(h / 24)
    return `${d} يوم`
  }
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

export function PresenceList({ currentUserId }: Props) {
  const { t, lang, isRtl } = useLanguage()
  const supabase = createClient()
  const [members, setMembers] = useState<Member[]>([])
  // The component does live time-since math + synthesizes a "self" row with
  // `new Date().toISOString()`, both of which produce different values on
  // the server (SSR) vs the client (hydration) and cause React to warn
  // about a hydration mismatch. Gate the dynamic UI behind a mounted flag
  // so SSR renders an empty shell and the time-dependent content only
  // appears once we're on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Pull the broadest set we'll need so the client can split into online/
  // offline locally. The threshold below filters anything stale.
  const load = useCallback(async () => {
    const cutoff = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, title, last_seen_at')
      .gt('last_seen_at', cutoff)
      .order('last_seen_at', { ascending: false })
      .limit(MAX_PER_SECTION * 4)
    setMembers((data || []) as Member[])
  }, [supabase])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const now = Date.now()
  // Always include the current user in the online section even if their
  // profile row hasn't been heartbeated yet — they're literally looking at
  // the dashboard, which means they are online. The heartbeat will update the
  // DB on the next tick and the local data will catch up.
  const knownIds = new Set(members.map(m => m.id))
  const enriched: Member[] = knownIds.has(currentUserId)
    ? members
    : [
        // Synthesize a placeholder "self" row — full_name etc. will fill in
        // on the next refresh, but the avatar circle still renders.
        { id: currentUserId, full_name: null, email: '', avatar_url: null, title: null, last_seen_at: new Date().toISOString() },
        ...members,
      ]

  const online = enriched
    .filter(m => m.id === currentUserId || now - new Date(m.last_seen_at).getTime() < ONLINE_THRESHOLD_MS)
    .sort((a, b) => {
      if (a.id === currentUserId) return -1
      if (b.id === currentUserId) return 1
      return 0
    })
    .slice(0, MAX_PER_SECTION)

  const offline = enriched
    .filter(m => m.id !== currentUserId && now - new Date(m.last_seen_at).getTime() >= ONLINE_THRESHOLD_MS)
    .slice(0, MAX_PER_SECTION)

  const langKey: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en'

  // Pre-mount: render a minimal placeholder so the server-rendered HTML
  // matches the first client render byte-for-byte (no Date.now usage, no
  // synthesized self row).
  if (!mounted) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-gray-900 flex-1">{t('presence_title')}</h3>
        </div>
        <div className="h-16" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-emerald-600" />
        <h3 className="text-sm font-semibold text-gray-900 flex-1">{t('presence_title')}</h3>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-emerald-700 bg-emerald-50">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {online.length} {t('presence_online_count')}
        </span>
      </div>

      {/* Online row */}
      <Subsection
        icon={<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
        label={t('presence_online_title')}
        empty={lang === 'ar' ? 'لا أحد متصل الآن' : 'No one online right now'}
      >
        {online.map(m => (
          <Bubble
            key={m.id}
            member={m}
            status="online"
            isSelf={m.id === currentUserId}
            selfLabel={t('presence_you')}
          />
        ))}
      </Subsection>

      {/* Divider */}
      {offline.length > 0 && <div className="my-3 border-t border-dashed border-gray-200" />}

      {/* Last-seen row */}
      {offline.length > 0 && (
        <Subsection
          icon={<Clock className="w-3 h-3 text-gray-400" />}
          label={t('presence_offline_title')}
        >
          {offline.map(m => (
            <Bubble
              key={m.id}
              member={m}
              status="offline"
              hint={timeAgoShort(m.last_seen_at, langKey)}
            />
          ))}
        </Subsection>
      )}
    </div>
  )
}

function Subsection({
  icon, label, empty, children,
}: {
  icon: React.ReactNode
  label: string
  empty?: string
  children: React.ReactNode
}) {
  // We check whether the children array is empty to render the placeholder.
  // React.Children.count works regardless of whether the caller passed an
  // array or a single node.
  const count = Array.isArray(children) ? children.length : (children ? 1 : 0)
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 px-1">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-gray-400 px-1 py-2">{empty}</p>
      ) : (
        // py-2 keeps the avatar ring + status dot from getting clipped by
        // overflow-x-auto (which implicitly clips the y-axis).
        <div className="flex items-start gap-3 overflow-x-auto py-2 -mx-1 px-1">
          {children}
        </div>
      )}
    </div>
  )
}

function Bubble({
  member, status, hint, isSelf, selfLabel,
}: {
  member: Member
  status: 'online' | 'offline'
  hint?: string
  isSelf?: boolean
  selfLabel?: string
}) {
  const initial = (member.full_name || member.email || '?')[0].toUpperCase()
  const displayName = isSelf && selfLabel
    ? selfLabel
    : (member.full_name || member.email.split('@')[0] || '—').split(' ')[0] || '—'

  return (
    <div className="flex-shrink-0 w-14 flex flex-col items-center text-center">
      <div className="relative">
        <div
          className={`w-12 h-12 rounded-full overflow-hidden flex items-center justify-center bg-gray-100 ${
            status === 'offline' ? 'opacity-80' : ''
          } ${isSelf ? 'ring-2 ring-emerald-400 ring-offset-1' : ''}`}
        >
          {member.avatar_url
            ? <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
            : <span className="text-sm font-bold text-gray-500">{initial}</span>}
        </div>
        <span
          className={`absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full border-2 border-white ${
            status === 'online' ? 'bg-emerald-500' : 'bg-gray-300'
          }`}
        />
      </div>
      <span className={`mt-1 text-[10.5px] font-medium max-w-[56px] truncate ${isSelf ? 'text-emerald-700' : 'text-gray-700'}`}>
        {displayName}
      </span>
      {hint && (
        <span className="text-[10px] text-gray-400 leading-tight">{hint}</span>
      )}
    </div>
  )
}
