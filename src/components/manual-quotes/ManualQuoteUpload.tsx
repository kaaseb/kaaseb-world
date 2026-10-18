'use client'

// "Upload file" popup for a manual quote: drag a spreadsheet from the desktop
// (or click to pick one). Our KAASEB template lands field-for-field; any other
// BOQ has its header row found, its sheets chosen, and its columns mapped.
// The table can be replaced or appended to.

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Loader2, UploadCloud, FileSpreadsheet, Download, CheckCircle2 } from 'lucide-react'
import { isTemplate, parseTemplate, parseBoqGrid, mergeImports, type Grid, type ImportResult } from '@/lib/manual-quotes/import'

const ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,.txt'

interface SheetPick { name: string; grid: Grid; rows: number; on: boolean }

export function ManualQuoteUpload({ open, onOpenChange, ar, lang, hasContent, onImport }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  ar: boolean
  lang: 'ar' | 'en'
  hasContent: boolean
  onImport: (r: ImportResult, mode: 'replace' | 'append') => void
}) {
  const tx = (a: string, e: string) => (ar ? a : e)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [fileName, setFileName] = useState('')
  const [template, setTemplate] = useState<ImportResult | null>(null)
  const [sheets, setSheets] = useState<SheetPick[]>([])

  function reset() { setFileName(''); setTemplate(null); setSheets([]) }

  async function read(file: File) {
    setBusy(true)
    reset()
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const grids = wb.SheetNames.map((name) => ({
        name,
        grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true, blankrows: true }) as Grid,
      }))
      setFileName(file.name)
      const tpl = grids.find((g) => isTemplate(g.grid))
      if (tpl) { setTemplate(parseTemplate(tpl.grid, lang)); return }
      const picks = grids
        .map((g) => ({ ...g, rows: g.grid.filter((r) => (r || []).some((c) => String(c ?? '').trim() !== '')).length, on: true }))
        .filter((g) => g.rows > 0)
      if (picks.length === 0) { toast.error(tx('الملف فارغ', 'The file is empty')); reset(); return }
      setSheets(picks)
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast.error(/password|encrypt/i.test(m) ? tx('الملف محمي بكلمة مرور — احفظه بدونها ثم ارفعه', 'Password-protected — save it without a password') : tx(`تعذّر قراءة الملف${m ? ` (${m})` : ''}`, `Could not read the file${m ? ` (${m})` : ''}`))
    } finally {
      setBusy(false)
    }
  }

  function apply(mode: 'replace' | 'append') {
    let r: ImportResult | null = template
    if (!r) {
      const chosen = sheets.filter((s) => s.on)
      if (chosen.length === 0) { toast.error(tx('اختر ورقة واحدة على الأقل', 'Pick at least one sheet')); return }
      r = mergeImports(chosen.map((s) => parseBoqGrid(s.grid, s.name)))
    }
    if (r.items.length === 0) { toast.error(tx('لا توجد بنود في الملف', 'No items in the file')); return }
    onImport(r, mode)
    toast.success(`${tx('تم السحب', 'Imported')}: ${r.notes.join(' • ')}`, { duration: 8000 })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { if (!o) reset(); onOpenChange(o) } }}>
      <DialogContent className="max-w-xl" dir={ar ? 'rtl' : 'ltr'}>
        <DialogHeader><DialogTitle>{tx('رفع ملف', 'Upload file')}</DialogTitle></DialogHeader>

        {!fileName ? (
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void read(f) }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition ${drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 hover:bg-slate-50'}`}
          >
            {busy ? <Loader2 className="w-8 h-8 animate-spin text-teal-600" /> : <UploadCloud className="w-10 h-10 text-teal-600" />}
            <span className="font-medium">{tx('اسحب الملف من سطح المكتب وأفلته هنا', 'Drag the file from your desktop and drop it here')}</span>
            <span className="text-xs text-muted-foreground">{tx('أو اضغط للاختيار — Excel (xlsx, xlsm, xls…) أو CSV', 'or click to choose — Excel (xlsx, xlsm, xls…) or CSV')}</span>
            <input type="file" accept={ACCEPT} className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /><span className="font-medium truncate">{fileName}</span></div>
            {template ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-1">
                <p className="font-medium flex items-center gap-1.5 text-emerald-800"><CheckCircle2 className="w-4 h-4" />{tx('قالب كاسب — كل شيء سينزل في مكانه', 'KAASEB template — everything lands in place')}</p>
                <p>{tx(`${template.items.length} بند`, `${template.items.length} item(s)`)}{template.columns.length ? ` • ${tx(`${template.columns.length} عمود إضافي`, `${template.columns.length} extra column(s)`)}` : ''}{template.info.project_name ? ` • ${template.info.project_name}` : ''}</p>
                <p className="text-xs text-muted-foreground">{tx('بيانات العميل والضريبة والتوصيل تُحدَّث من الملف أيضاً.', 'Client details, VAT and delivery are updated from the file too.')}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{tx('الأوراق المراد سحبها:', 'Sheets to import:')}</p>
                {sheets.map((s, i) => (
                  <label key={s.name} className="flex items-center gap-2 text-sm rounded border px-2 py-1.5 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={s.on} onChange={(e) => setSheets((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} className="accent-teal-600" />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{tx(`${s.rows} صف`, `${s.rows} rows`)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">{tx('يُكتشف سطر العناوين تلقائياً، وتُربط أعمدة الوصف والكمية والوحدة والسعر، وباقي الأعمدة تُنسخ كما هي.', 'The header row is found automatically; description, quantity, unit and price are mapped, every other column is kept as-is.')}</p>
              </div>
            )}
            <button type="button" onClick={reset} className="text-xs text-sky-700 hover:underline">{tx('اختيار ملف آخر', 'Choose another file')}</button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-t pt-3">
          <span>{tx('تشتغل على إكسل خارجي؟', 'Working in Excel?')}</span>
          <a href={`/api/manual-quotes/template?lang=${lang}`} className="inline-flex items-center gap-1 text-teal-700 hover:underline"><Download className="w-3.5 h-3.5" />{tx('حمّل قالب كاسب الجاهز', 'Download the KAASEB template')}</a>
        </div>

        {fileName && (
          <DialogFooter className="gap-2">
            {hasContent && <Button variant="outline" onClick={() => apply('append')} disabled={busy}>{tx('إضافة للجدول الحالي', 'Append to the table')}</Button>}
            <Button onClick={() => { if (!hasContent || window.confirm(tx('سيُستبدل الجدول الحالي بمحتوى الملف. متابعة؟', 'This replaces the current table. Continue?'))) apply('replace') }} disabled={busy}>
              {hasContent ? tx('استبدال الجدول', 'Replace the table') : tx('سحب', 'Import')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
