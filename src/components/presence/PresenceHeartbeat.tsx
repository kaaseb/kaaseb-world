'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  userId: string
}

const INTERVAL_MS = 60_000   // ping every 60s while the tab is visible
const MIN_GAP_MS  = 30_000   // never ping more than once per 30s, even on rapid focus events

// Invisible component mounted once per dashboard tab. Updates the caller's
// `profiles.last_seen_at` so the dashboard widget can show who's online.
//
// Strategy:
//   • Tick on mount.
//   • Tick every 60s while the tab is visible.
//   • Tick again whenever the tab regains focus or visibility — covers the
//     "back from another window" case without waiting for the next interval.
//   • Skip ticks when the tab is hidden, so a backgrounded tab doesn't keep
//     pretending the user is online.
export function PresenceHeartbeat({ userId }: Props) {
  const supabase = createClient()
  const lastTickRef = useRef(0)

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    async function tick() {
      const now = Date.now()
      if (now - lastTickRef.current < MIN_GAP_MS) return
      lastTickRef.current = now
      // Best-effort — failures are silent; the worst case is the user shows
      // as "last seen 2 min ago" instead of "now".
      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId)
        .then(() => undefined)
    }

    function maybeTick() {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      tick()
    }

    maybeTick()
    const interval = setInterval(maybeTick, INTERVAL_MS)
    document.addEventListener('visibilitychange', maybeTick)
    window.addEventListener('focus', maybeTick)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', maybeTick)
      window.removeEventListener('focus', maybeTick)
    }
  // We deliberately don't include `supabase` in deps — the client is a stable
  // singleton and re-running this effect on every render would defeat the
  // throttle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return null
}
