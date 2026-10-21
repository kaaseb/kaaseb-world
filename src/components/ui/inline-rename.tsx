'use client'

// Quick rename from a list: a pencil next to the name opens a small box right
// there (one field, or Arabic + English). Enter saves, Esc / outside cancels.
// Nothing navigates away and nothing else on the row changes.

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'

export interface RenameField {
  key: string
  label: string
  value: string
  dir?: 'rtl' | 'ltr'
  placeholder?: string
}

export function InlineRename({ ar, title, load, onSave }: {
  ar: boolean
  /** Tooltip / aria label for the pencil. */
  title: string
  /** The fields to edit — may be fetched (e.g. both languages) when opened. */
  load: () => Promise<RenameField[]> | RenameField[]
  /** Saves; returns an error message or null. */
  onSave: (values: Record<string, string>) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState<RenameField[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  // Fixed position from the pencil: lists sit in cards/tables that clip overflow.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !busy) setOpen(false) }
    // The box is pinned to the screen — scrolling would detach it from its row.
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node) && !busy) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, busy])

  async function start(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const r = pencil.current?.getBoundingClientRect()
    if (r) {
      const w = Math.min(320, window.innerWidth - 32)
      const left = Math.max(16, Math.min(ar ? r.right - w : r.left, window.innerWidth - w - 16))
      // Not enough room under the pencil (row near the bottom of a phone) → open upward.
      const roomBelow = window.innerHeight - r.bottom
      setPos(roomBelow < 260 && r.top > roomBelow ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left })
    }
    setOpen(true); setError(null); setFields(null)
    try {
      const f = await load()
      setFields(f)
      setValues(Object.fromEntries(f.map((x) => [x.key, x.value])))
      setTimeout(() => { first.current?.focus(); first.current?.select() }, 0)
    } catch {
      setError(ar ? 'تعذّر التحميل' : 'Could not load')
    }
  }

  async function save() {
    if (busy || !fields) return
    setBusy(true); setError(null)
    const err = await onSave(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()])))
    setBusy(false)
    if (err) setError(err); else setOpen(false)
  }

  return (
    // Clicks and keys stay inside: rows are often clickable links (Enter = open).
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        ref={pencil}
        type="button"
        onClick={start}
        title={title}
        aria-label={title}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted transition"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={box}
          dir={ar ? 'rtl' : 'ltr'}
          style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : undefined}
          className="fixed z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border bg-card shadow-xl p-3 space-y-2 text-start"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); if (!busy) setOpen(false) }
            if (e.key === 'Enter') { e.preventDefault(); save() }
          }}
        >
          {!fields && !error && <div className="py-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
          {fields?.map((f, i) => (
            <label key={f.key} className="block">
              <span className="block text-[11px] text-muted-foreground mb-1">{f.label}</span>
              <input
                ref={i === 0 ? first : undefined}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.slice(0, 200) }))}
                dir={f.dir}
                placeholder={f.placeholder}
                className="w-full h-10 sm:h-9 rounded-lg border bg-background px-3 text-base sm:text-sm outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              />
            </label>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {fields && (
            <div className="flex gap-1.5 pt-1">
              <button type="button" onClick={save} disabled={busy}
                className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{ar ? 'حفظ' : 'Save'}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={busy}
                className="h-9 px-3 rounded-lg bg-muted hover:bg-muted/70 text-sm inline-flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
