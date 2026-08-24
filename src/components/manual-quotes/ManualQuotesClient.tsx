'use client'

// عروض يدوية — the list. Create a new one (auto-numbered from 100) or open one.

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, Plus, Loader2, Trash2, ExternalLink, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ManualQuote } from '@/lib/manual-quotes/store'

function quoteTotal(q: ManualQuote): number {
  const sub = q.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  return sub * (1 + (q.vat_rate || 0))
}

export function ManualQuotesClient({ initialQuotes }: { initialQuotes: ManualQuote[] }) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'
  const router = useRouter()
  const [quotes, setQuotes] = useState<ManualQuote[]>(initialQuotes)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return quotes
    return quotes.filter((q) =>
      String(q.number).includes(s)
      || `${q.company || ''} ${q.client_name || ''} ${q.project_name || ''} ${q.subject || ''}`.toLowerCase().includes(s))
  }, [quotes, search])

  async function create() {
    setCreating(true)
    try {
      const res = await fetch('/api/manual-quotes', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.quote) { toast.error(j.error || 'فشل الإنشاء'); return }
      router.push(`/manual-quotes/${j.quote.id}`)
    } catch { toast.error('فشل الإنشاء') } finally { setCreating(false) }
  }

  async function remove(id: string) {
    if (!confirm(ar ? 'حذف هذا العرض؟' : 'Delete this quote?')) return
    const prev = quotes
    setQuotes((l) => l.filter((q) => q.id !== id))
    try {
      const res = await fetch(`/api/manual-quotes/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch { setQuotes(prev); toast.error('فشل الحذف') }
  }

  const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(ar ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' }) }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-md">
            <FileSpreadsheet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{ar ? 'عروض يدوية' : 'Manual Quotes'}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{ar ? 'عروض سعرية تُنشأ يدوياً — الترقيم يبدأ من ١٠٠' : 'Hand-built quotations — numbered from 100'}</p>
          </div>
        </div>
        <Button onClick={create} disabled={creating} className="gap-2">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {ar ? 'عرض جديد' : 'New quote'}
        </Button>
      </div>

      {quotes.length > 0 && (
        <div className="relative mb-3">
          <Search className={`w-4 h-4 text-muted-foreground absolute top-1/2 -translate-y-1/2 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ar ? 'بحث بالرقم / العميل / الشركة / المشروع…' : 'Search by number / client / company / project…'}
            className={`w-full h-10 rounded-lg border bg-white text-sm outline-none focus:border-teal-400 ${isRtl ? 'pr-9 pl-8' : 'pl-9 pr-8'}`}
          />
          {search && (
            <button onClick={() => setSearch('')} className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground ${isRtl ? 'left-2.5' : 'right-2.5'}`}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {quotes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {ar ? 'لا عروض بعد — أنشئ أول عرض.' : 'No quotes yet — create your first.'}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {ar ? 'لا نتائج للبحث.' : 'No results.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((q) => (
            <Card key={q.id} className="hover:bg-muted/30 transition-colors">
              <CardContent className="p-3 flex items-center gap-3">
                <button onClick={() => router.push(`/manual-quotes/${q.id}`)} className="flex-1 min-w-0 text-start flex items-center gap-3">
                  <span className="inline-flex items-center justify-center min-w-12 h-8 px-2 rounded-lg bg-teal-50 text-teal-700 font-bold text-sm">#{q.number}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{q.company || q.client_name || (ar ? '(بلا اسم)' : '(untitled)')}</span>
                    <span className="block text-xs text-muted-foreground truncate">{q.items.length} {ar ? 'بند' : 'items'} · {fmt(q.createdAt)}</span>
                  </span>
                </button>
                <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                  {quoteTotal(q).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {q.currency}
                </span>
                <a href={`/print/manual-quote/${q.id}`} target="_blank" rel="noopener noreferrer" title={ar ? 'طباعة/PDF' : 'Print/PDF'}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-muted transition"><ExternalLink className="w-4 h-4" /></a>
                <Button variant="ghost" size="icon-sm" onClick={() => remove(q.id)} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
