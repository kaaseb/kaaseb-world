'use client'

// Autosave for editors (Furn pricing table, manual quotations).
//
// The contract every editor relies on:
//   • an edit arms a short timer; the timer saves the LATEST value,
//   • saves are SERIALISED through one chain and each save writes whatever the
//     latest value is when IT starts. So `await flush()` always means "what I
//     can see on screen is now on the server" — never "an older write finished".
//     That guarantee is what makes it safe to generate a quotation PDF right
//     after a flush: the PDF is rendered from the database.
//   • a failed save keeps the document dirty, sets status 'error' and REJECTS,
//     so the caller (Save button, Send quotation) can stop instead of shipping
//     stale data,
//   • leaving the tab (hidden), closing it, or navigating away inside the app
//     (unmount — which fires neither beforeunload nor visibilitychange) all
//     flush what is pending,
//   • values the SERVER pushed in (after an AI run, a reload) are not edits:
//     call markClean() immediately before setting them and the next value
//     change is not treated as an edit.
//
// The manual Save button calls flush(true): saves even when nothing changed
// (people click Save to feel safe — let it always do something).

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface SaveContext {
  /** true when the tab is hiding/closing or the editor is unmounting — the
   *  persist function may use a keepalive request (small bodies only). */
  leaving: boolean
}

export interface Autosave {
  status: AutosaveStatus
  savedAt: Date | null
  error: string | null
  /** Save now and resolve only when the CURRENT value is persisted. `force`
   *  saves even when clean. Rejects if the save failed. */
  flush: (force?: boolean) => Promise<void>
  /** The next value comes from the server — do not treat it as an edit. */
  markClean: () => void
  dirty: boolean
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
  const enabledRef = useRef(enabled)

  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  const skipArm = useRef(false)
  const leaving = useRef(false)
  const alive = useRef(true)
  const chain = useRef<Promise<void>>(Promise.resolve())

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d
    if (alive.current) setIsDirty(d)
  }, [])

  // One chain: a save never overlaps another, and a save queued behind an
  // in-flight one still writes the newest value (it reads `latest` when it
  // starts). Awaiting the returned promise therefore awaits THIS value.
  const doSave = useCallback((): Promise<void> => {
    const run = chain.current.catch(() => {}).then(async () => {
      const snapshot = latest.current
      if (alive.current) setStatus('saving')
      try {
        await saveRef.current(snapshot, { leaving: leaving.current })
        // Edits that landed DURING the save keep the document dirty.
        if (latest.current === snapshot) setDirty(false)
        if (alive.current) {
          setSavedAt(new Date())
          setError(null)
          setStatus(latest.current === snapshot ? 'saved' : 'pending')
        }
      } catch (e) {
        if (alive.current) {
          setError(e instanceof Error ? e.message : 'فشل الحفظ')
          setStatus('error')
        }
        throw e
      }
    })
    chain.current = run.catch(() => {})
    return run
  }, [setDirty])

  const flush = useCallback(async (force = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!force && !dirty.current) return
    await doSave()
  }, [doSave])

  // Call this immediately BEFORE setting a value that came from the server; the
  // value change it causes is then not treated as an edit.
  const markClean = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setDirty(false)
    skipArm.current = true
    if (alive.current) setStatus((s) => (s === 'pending' ? 'idle' : s))
  }, [setDirty])

  // Keep the refs in step with the props. This runs BEFORE the arming effect
  // below (effects fire in declaration order), so the timer and every queued
  // save always read the value that was just rendered. Writing refs during
  // render would be cheaper but is unsafe in concurrent React.
  useEffect(() => {
    latest.current = value
    saveRef.current = save
    enabledRef.current = enabled
  })

  // Arm the timer on every change of `value` after mount.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (skipArm.current) { skipArm.current = false; return }
    if (!enabledRef.current) return
    // Marking dirty in the effect is the point: the badge and the "leave page?"
    // guard must be correct from the keystroke onward, not one render later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDirty(true)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void doSave().catch(() => {}) }, delay)
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  }, [value, delay, doSave, setDirty])

  // Leaving the tab flushes; closing it with unsaved edits warns; unmounting
  // (client-side navigation, e.g. the back link) flushes too — that path fires
  // neither beforeunload nor visibilitychange, and used to drop the last edit.
  useEffect(() => {
    alive.current = true
    const leave = () => {
      leaving.current = true
      void flush().catch(() => {}).finally(() => { leaving.current = false })
    }
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
      if (dirty.current && enabledRef.current) {
        leaving.current = true
        void doSave().catch(() => {})
      }
      // State setters are no-ops from here on; the save itself still completes.
      alive.current = false
    }
  }, [flush, doSave])

  return { status, savedAt, error, flush, markClean, dirty: isDirty }
}
