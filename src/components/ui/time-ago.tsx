'use client'

import { useEffect, useState } from 'react'

/**
 * Renders a human "time ago" label safely for SSR/client hydration.
 * Empty on the first render, filled in on mount, refreshes every 60s.
 */
export function TimeAgo({ iso, short = false, className }: {
  iso: string
  short?: boolean
  className?: string
}) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    function compute() {
      const diff = Date.now() - new Date(iso).getTime()
      const m = Math.floor(diff / 60000)
      if (m < 1) return short ? 'الآن' : 'الآن'
      if (m < 60) return short ? `${m}m` : `منذ ${m} د`
      const h = Math.floor(m / 60)
      if (h < 24) return short ? `${h}h` : `منذ ${h} س`
      const d = Math.floor(h / 24)
      return short ? `${d}d` : `منذ ${d} يوم`
    }
    setLabel(compute())
    const id = setInterval(() => setLabel(compute()), 60_000)
    return () => clearInterval(id)
  }, [iso, short])

  return <span className={className} suppressHydrationWarning>{label}</span>
}

/**
 * Conversation list preview: today = time, this week = day name, else = date.
 */
export function TimeShort({ iso, className }: { iso: string, className?: string }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    function compute() {
      const d = new Date(iso)
      const now = new Date()
      const sameDay = d.toDateString() === now.toDateString()
      if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
      if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
      return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
    }
    setLabel(compute())
    const id = setInterval(() => setLabel(compute()), 60_000)
    return () => clearInterval(id)
  }, [iso])
  return <span className={className} suppressHydrationWarning>{label}</span>
}
