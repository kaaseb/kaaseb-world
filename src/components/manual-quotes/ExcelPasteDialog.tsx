'use client'

// Paste a range copied from Excel and map its columns to quote fields. Because
// the BOQ files differ (in one the Qty is column C and Unit is D; in another the
// Unit is C and Qty is D), fixed positions don't work — the team picks which
// pasted column is the item / quantity / unit / price / a custom column. Section
// header rows (e.g. "SECTION 1 — …", "06 - WOOD …") and rows without a real
// quantity are skipped automatically.

import { useState, useMemo } from 'react'
import { X, ClipboardPaste, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ManualQuoteItem, ManualQuoteColumn } from '@/lib/manual-quotes/store'

function rid() { return `${Math.random().toString(36).slice(2, 10)}` }

type Target = 'ignore' | 'description' | 'details' | 'quantity' | 'unit' | 'price' | string // `col:<id>`

function parseGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines.map((l) => l.split('\t'))
}
function num(v: string): number | null {
  const raw = String(v ?? '').trim()
  if (!raw) return null
  const n = Number(raw.replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
function isSection(s: string): boolean {
  const t = (s || '').trim()
  if (!t) return true
  return /^(section|القسم)\b/i.test(t) || /^\d{1,2}\s*[-–—]\s*[A-Za-z؀-ۿ]/.test(t)
}
const HEAD = {
  description: /desc|item description|البند|الوصف|الصنف/i,
  quantity: /\bqty\b|quantity|كمية/i,
  unit: /\bunit\b|uom|وحدة/i,
  price: /rate|price|سعر/i,
  details: /remark|detail|\bsize\b|مقاس|spec|تفاصيل|ملاحظ/i,
}

function detect(grid: string[][], colCount: number): { mapping: Record<number, Target>; header: boolean } {
  if (grid.length === 0) return { mapping: {}, header: false }
  const first = grid[0].map((c) => (c || '').trim())
  const looksHeader = first.some((c) => HEAD.description.test(c) || HEAD.quantity.test(c))
  const m: Record<number, Target> = {}
  for (let i = 0; i < colCount; i++) m[i] = 'ignore'
  if (looksHeader) {
    first.forEach((c, i) => {
      if (HEAD.description.test(c)) m[i] = 'description'
      else if (HEAD.quantity.test(c)) m[i] = 'quantity'
      else if (HEAD.unit.test(c)) m[i] = 'unit'
      else if (HEAD.price.test(c)) m[i] = 'price'
      else if (HEAD.details.test(c)) m[i] = 'details'
    })
  } else {
    // No header: pick the widest text column as the item description.
    const sample = grid.find((r) => r.some((c) => c && c.trim())) || []
    let descI = 0, best = -1
    for (let i = 0; i < colCount; i++) { const len = (sample[i] || '').trim().length; if (len > best) { best = len; descI = i } }
    m[descI] = 'description'
  }
  return { mapping: m, header: looksHeader }
}

export function ExcelPasteDialog({ columns, ar, onClose, onImport }: {
  columns: ManualQuoteColumn[]
  ar: boolean
  onClose: () => void
  onImport: (items: ManualQuoteItem[]) => void
}) {
  const t = (a: string, e: string) => (ar ? a : e)
  const [text, setText] = useState('')
  const [mapping, setMapping] = useState<Record<number, Target>>({})
  const [headerRow, setHeaderRow] = useState(true)

  const grid = useMemo(() => parseGrid(text), [text])
  const colCount = useMemo(() => grid.reduce((m, r) => Math.max(m, r.length), 0), [grid])

  function onTextChange(v: string) {
    setText(v)
    const g = parseGrid(v)
    const cc = g.reduce((m, r) => Math.max(m, r.length), 0)
    const d = detect(g, cc)
    setMapping(d.mapping)
    setHeaderRow(d.header)
  }

  const colOf = (target: Target): number | null => {
    for (let i = 0; i < colCount; i++) if (mapping[i] === target) return i
    return null
  }

  // Build the items the current mapping would produce.
  const built = useMemo<ManualQuoteItem[]>(() => {
    const descCol = colOf('description')
    if (descCol == null) return []
    const qtyCol = colOf('quantity'), unitCol = colOf('unit'), priceCol = colOf('price'), detailsCol = colOf('details')
    const customCols = Object.entries(mapping)
      .filter(([, tg]) => typeof tg === 'string' && tg.startsWith('col:'))
      .map(([i, tg]) => ({ i: Number(i), id: (tg as string).slice(4) }))
    const rows = grid.slice(headerRow ? 1 : 0)
    const out: ManualQuoteItem[] = []
    for (const row of rows) {
      const desc = (row[descCol] || '').trim()
      if (!desc || isSection(desc)) continue
      const qv = qtyCol != null ? num(row[qtyCol]) : null
      if (qtyCol != null && (qv == null || qv <= 0)) continue // section subheaders have no qty
      const custom: Record<string, string> = {}
      for (const c of customCols) { const v = (row[c.i] || '').trim(); if (v) custom[c.id] = v.slice(0, 300) }
      out.push({
        id: rid(),
        description: desc.slice(0, 400),
        details: detailsCol != null ? (row[detailsCol] || '').trim().slice(0, 1000) : '',
        quantity: qv != null ? qv : 1,
        unit: unitCol != null ? (row[unitCol] || '').trim().slice(0, 20) : '',
        unit_price: priceCol != null ? num(row[priceCol]) : null,
        imageUrl: null,
        ...(Object.keys(custom).length ? { custom } : {}),
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, mapping, headerRow, colCount])

  const hasDesc = colOf('description') != null
  const previewRows = grid.slice(0, 10)

  const OPTIONS: Array<{ v: Target; label: string }> = [
    { v: 'ignore', label: t('تجاهل', 'Ignore') },
    { v: 'description', label: t('البند', 'Item') },
    { v: 'details', label: t('التفاصيل', 'Details') },
    { v: 'quantity', label: t('الكمية', 'Qty') },
    { v: 'unit', label: t('الوحدة', 'Unit') },
    { v: 'price', label: t('السعر', 'Price') },
    ...columns.map((c) => ({ v: `col:${c.id}` as Target, label: c.name })),
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div dir={ar ? 'rtl' : 'ltr'} className="bg-background rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 p-3 border-b">
          <h3 className="font-semibold flex items-center gap-2"><ClipboardPaste className="w-4 h-4 text-teal-600" />{t('لصق بنود من إكسل', 'Paste items from Excel')}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="p-3 overflow-y-auto space-y-3">
          <p className="text-xs text-muted-foreground">{t('انسخ النطاق من إكسل والصقه هنا، ثم اختر أي عمود يقابل «البند» والكمية… عناوين الأقسام تُتجاهل تلقائياً.', 'Copy a range from Excel and paste here, then map which column is the Item, Qty… Section headers are skipped automatically.')}</p>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t('الصق هنا…', 'Paste here…')}
            rows={4}
            className="w-full rounded-lg border p-2 text-sm font-mono bg-white outline-none focus:border-teal-400"
          />

          {grid.length > 0 && colCount > 0 && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} className="accent-teal-600" />
                {t('أول صف عناوين (تجاهله)', 'First row is a header (skip it)')}
              </label>

              <div className="overflow-x-auto border rounded-lg">
                <table className="text-xs min-w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      {Array.from({ length: colCount }).map((_, i) => (
                        <th key={i} className="p-1.5 border-b border-e align-top">
                          <select
                            value={mapping[i] || 'ignore'}
                            onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value as Target }))}
                            className={`w-full rounded border px-1 py-0.5 text-[11px] outline-none ${mapping[i] && mapping[i] !== 'ignore' ? 'bg-teal-50 border-teal-300 text-teal-800 font-medium' : 'bg-white text-gray-500'}`}
                          >
                            {OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri} className={headerRow && ri === 0 ? 'opacity-40 line-through' : ''}>
                        {Array.from({ length: colCount }).map((_, ci) => (
                          <td key={ci} className="p-1.5 border-b border-e max-w-[160px] truncate text-gray-700">{(row[ci] || '').trim()}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {grid.length > previewRows.length && <p className="text-[11px] text-muted-foreground">{t(`… و${grid.length - previewRows.length} صف إضافي`, `… and ${grid.length - previewRows.length} more rows`)}</p>}
            </>
          )}
        </div>

        <div className="p-3 border-t flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {!hasDesc && grid.length > 0
              ? t('اختر عمود «البند» أولاً', 'Pick the "Item" column first')
              : t(`سيُضاف ${built.length} بند`, `${built.length} items will be added`)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t('إلغاء', 'Cancel')}</Button>
            <Button size="sm" disabled={built.length === 0} onClick={() => { onImport(built); onClose() }} className="gap-1.5">
              <Check className="w-4 h-4" />{t('إضافة', 'Add')} {built.length > 0 ? `(${built.length})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
