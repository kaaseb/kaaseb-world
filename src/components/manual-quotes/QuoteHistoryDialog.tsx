'use client'

// «السجل» — who changed this quote, what and when. Opens only on request.
// Each entry can be restored: the quote goes back to how it was BEFORE it.

import { useState } from 'react'
import { History, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ManualQuote } from '@/lib/manual-quotes/store'
import type { QuoteChange, HistorySource } from '@/lib/manual-quotes/history'

interface Entry { id: string; at: string; lastAt: string; byName: string; source: HistorySource; changes: QuoteChange[] }

const SRC: Record<HistorySource, { ar: string; en: string; cls: string }> = {
  editor: { ar: 'من الصفحة', en: 'Page', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
  chat: { ar: 'من كاسب AI', en: 'Kaaseb AI', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' },
  restore: { ar: 'استرجاع', en: 'Restore', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300' },
}

export function QuoteHistoryButton({ quoteId, number, ar, beforeOpen, onRestored }: {
  quoteId: string
  number: number
  ar: boolean
  /** Save what is on screen first, so the list includes it. */
  beforeOpen: () => Promise<void>
  onRestored: (q: ManualQuote) => void
}) {
  const tx = (a: string, e: string) => (ar ? a : e)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [restoring, setRestoring] = useState<string | null>(null)

  async function load() {
    setOpen(true)
    setLoading(true)
    try {
      await beforeOpen().catch(() => {})
      const r = await fetch(`/api/manual-quotes/${quoteId}/history`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error)
      setEntries(Array.isArray(j.entries) ? j.entries : [])
    } catch {
      toast.error(tx('تعذّر تحميل السجل', 'Could not load the history'))
    } finally { setLoading(false) }
  }

  async function restore(e: Entry) {
    if (!confirm(tx(`ترجع العرض لما كان قبل تعديل ${e.byName}؟ (ينحفظ الاسترجاع في السجل وتقدر تتراجع عنه)`, `Restore to before ${e.byName}'s change? (recorded, can be undone)`))) return
    setRestoring(e.id)
    try {
      const r = await fetch(`/api/manual-quotes/${quoteId}/history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: e.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.quote) throw new Error(j.error)
      onRestored(j.quote as ManualQuote)
      toast.success(tx('تم الاسترجاع ✓', 'Restored ✓'))
      setOpen(false)
    } catch (err) {
      toast.error((err as Error)?.message || tx('تعذّر الاسترجاع', 'Restore failed'))
    } finally { setRestoring(null) }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <>
      <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
        <History className="w-4 h-4" />{tx('السجل', 'History')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] flex flex-col" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader><DialogTitle>{tx(`سجل تعديلات العرض #${number}`, `Quote #${number} history`)}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2.5">
            {loading ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : entries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tx('ما فيه تعديلات مسجّلة بعد.', 'No recorded changes yet.')}</p>
            ) : entries.map((e) => (
              <div key={e.id} className="rounded-xl border p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{e.byName || '—'}</p>
                    <p className="text-[11px] text-muted-foreground">{when(e.lastAt)}</p>
                  </div>
                  <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${SRC[e.source].cls}`}>{ar ? SRC[e.source].ar : SRC[e.source].en}</span>
                  <Button variant="ghost" size="sm" disabled={!!restoring} onClick={() => restore(e)} className="h-7 px-2 gap-1 text-xs" title={tx('رجّع لما قبل هذا التعديل', 'Restore to before this change')}>
                    {restoring === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}{tx('رجّع', 'Restore')}
                  </Button>
                </div>
                <ul className="mt-2 space-y-1">
                  {e.changes.slice(0, 25).map((c, i) => (
                    <li key={i} className="text-xs leading-relaxed">
                      <span className="text-muted-foreground"><bdi>{c.item ? `${c.item} — ` : ''}{c.label}</bdi></span>{' '}
                      {c.before !== undefined && <span className="rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-1 line-through"><bdi>{c.before}</bdi></span>}
                      {c.before !== undefined && c.after !== undefined && <span className="text-muted-foreground"> ← </span>}
                      {c.after !== undefined && <span className="rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1 font-semibold"><bdi>{c.after}</bdi></span>}
                    </li>
                  ))}
                  {e.changes.length > 25 && <li className="text-[11px] text-muted-foreground">+{e.changes.length - 25}</li>}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
