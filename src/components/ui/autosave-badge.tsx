'use client'

// The one-line autosave status shown next to a Save button.

import { Loader2, Check, AlertTriangle, CloudUpload } from 'lucide-react'
import type { Autosave } from '@/hooks/useAutosave'

export function AutosaveBadge({ a, ar }: { a: Autosave; ar: boolean }) {
  const time = a.savedAt ? a.savedAt.toLocaleTimeString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
  if (a.status === 'saving') return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />{ar ? 'يحفظ…' : 'Saving…'}</span>
  )
  if (a.status === 'error') return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600" title={a.error || undefined}><AlertTriangle className="w-3.5 h-3.5" />{ar ? 'لم يُحفظ — اضغط حفظ' : 'Not saved — press Save'}</span>
  )
  if (a.status === 'pending' || a.dirty) return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700"><CloudUpload className="w-3.5 h-3.5" />{ar ? 'تعديلات غير محفوظة…' : 'Unsaved edits…'}</span>
  )
  if (a.status === 'saved' && a.savedAt) return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="w-3.5 h-3.5" />{ar ? `حُفظ تلقائياً ${time}` : `Autosaved ${time}`}</span>
  )
  return null
}
