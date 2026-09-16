'use client'

// Autosave for editors (Furn pricing table, manual quotations).
//
// Rules — the same for every editor that uses it:
//   • an edit marks the document dirty and arms a short timer; the timer saves
//     the LATEST value (edits during a save queue exactly one more save),
//   • saves never overlap; a failed save keeps the document dirty and reports
//     the error so the manual Save button still works as the safety net,
//   • leaving the tab (visibilitychange → hidden) flushes immediately — that
//     covers "switched to WhatsApp / closed the laptop" on mobile too,
//   • closing the tab with unsaved edits asks the browser's "leave page?"
//     prompt, and tries a keepalive save on the way out,
//   • values the SERVER pushed in (after "Retry", a reload) are not edits:
//     call markClean() after setting them so nothing is re-sent.
//
// The manual Save button calls flush(true): saves now even when nothing
// changed (people click Save to feel safe — let it always do something).

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface Autosave {
  status: AutosaveStatus
  savedAt: Date | null
  error: string | null
  /** Save now. `force` saves even when clean. Rejects on failure. */
  flush: (force?: boolean) => Promise<void>
  /** The current value came from the server — do not treat it as an edit. */
  markClean: () => void
  dirty: boolean
}

export interface SaveContext {
  /** true when the tab is hiding/closing — the persist function may use a
   *  keepalive request (small bodies only; browsers cap those at 64KB). */
  leaving: boolean
}

export function useAutosave<T>(
  value: T,
  save: (value: T, ctx: SaveContext) => Promise<void>,
  opts: { delayMs?: number; enabled?: boolean } = {},
): Autosave {
  const delay = opts.delayMs ?? 1500
  const enabled = opts.enabled ?? true

  const latest = useRef(value)
  const saveRef = useRef(save)
  const dirty = useRef(false)
  const saving = useRef(false)
  const again = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  const enabledRef = useRef(enabled)

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  latest.current = value
  saveRef.current = save
  enabledRef.current = enabled

  const setDirty = useCallback((d: boolean) => { dirty.current = d; setIsDirty(d) }, [])

  const leaving = useRef(false)
  const runSave = useCallback(async (): Promise<void> => {
    if (saving.current) { again.current = true; return }
    saving.current = true
    setStatus('saving')
    const snapshot = latest.current
    try {
      await saveRef.current(snapshot, { leaving: leaving.current })
      // Edits that landed DURING the save keep the document dirty.
      if (latest.current === snapshot) setDirty(false)
      setSavedAt(new Date())
      setError(null)
      setStatus(latest.current === snapshot ? 'saved' : 'pending')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الحفظ')
      setStatus('error')
      throw e
    } finally {
      saving.current = false
      if (again.current) { again.current = false; void runSave().catch(() => {}) }
    }
  }, [setDirty])

  const flush = useCallback(async (force = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!force && !dirty.current) return
    await runSave()
  }, [runSave])

  const markClean = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setDirty(false)
    setStatus((s) => (s === 'pending' ? 'idle' : s))
  }, [setDirty])

  // Arm the timer on every change of `value` after mount.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!enabledRef.current) return
    setDirty(true)
    setStatus('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void runSave().catch(() => {}) }, delay)
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [value, delay, runSave, setDirty])

  // Leaving the tab flushes; closing it with unsaved edits warns.
  useEffect(() => {
    const leave = () => { leaving.current = true; void flush().catch(() => {}).finally(() => { leaving.current = false }) }
    const onHide = () => { if (document.visibilityState === 'hidden' && dirty.current && enabledRef.current) leave() }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current || !enabledRef.current) return
      leave()
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [flush])

  return { status, savedAt, error, flush, markClean, dirty: isDirty }
}
