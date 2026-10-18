'use client'

// "Duplicate" for a manual quote: a full editable copy with the NEXT quote
// number and a title the team types (pre-filled from the original).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Copy, Loader2 } from 'lucide-react'

export function DuplicateQuoteButton({ quoteId, number, subject, ar, beforeCopy, size = 'sm', variant = 'outline' }: {
  quoteId: string
  number: number
  subject: string
  ar: boolean
  /** Flush unsaved edits first so the copy includes them. */
  beforeCopy?: () => Promise<void>
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost'
}) {
  const router = useRouter()
  const tx = (a: string, e: string) => (ar ? a : e)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    if (busy) return
    setBusy(true)
    try {
      await beforeCopy?.()
      const res = await fetch('/api/manual-quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateOf: quoteId, subject: title.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.quote) { toast.error(j.error || tx('فشل النسخ', 'Copy failed')); return }
      toast.success(tx(`أُنشئ العرض #${j.quote.number}`, `Quote #${j.quote.number} created`))
      setOpen(false)
      router.push(`/manual-quotes/${j.quote.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx('فشل النسخ', 'Copy failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size={size} variant={variant} className="gap-1.5" onClick={() => { setTitle(subject ? `${subject} ${tx('(نسخة)', '(copy)')}` : ''); setOpen(true) }} title={tx('نسخ العرض', 'Duplicate')}>
        <Copy className="w-3.5 h-3.5" />{tx('نسخ', 'Duplicate')}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o) }}>
        <DialogContent className="max-w-md" dir={ar ? 'rtl' : 'ltr'}>
          <DialogHeader><DialogTitle>{tx(`نسخ العرض #${number}`, `Duplicate quote #${number}`)}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>{tx('عنوان العرض الجديد', 'Title of the new quote')}</Label>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go() }} />
            <p className="text-xs text-muted-foreground">{tx('نسخة كاملة بكل البنود والأعمدة، برقم عرض جديد، وتقدر تعدّل عليها بحرية.', 'A full copy with every item and column, under a new quote number — edit it freely.')}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{tx('إلغاء', 'Cancel')}</Button>
            <Button onClick={go} disabled={busy} className="gap-1.5">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{tx('إنشاء النسخة', 'Create copy')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
