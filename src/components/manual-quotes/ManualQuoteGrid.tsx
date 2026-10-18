'use client'

// The manual-quote table, built like a spreadsheet:
//   • real rows × columns, in the team's own column order
//   • a "+" between every two columns (insert a column there — for the quote,
//     or for the management only) and on every row (insert a row below it)
//   • every column can be shown on the quotation or kept internal; custom
//     columns can be renamed and deleted, rows deleted or duplicated
//   • an image cell per row: click, drop a file on it, or paste a screenshot
//   • Enter moves down like Excel; pasting a block copied from Excel fills the
//     cells to the right and below, adding rows when needed.
// The column model lives in lib/manual-quotes/layout (shared with print/import).

import { Fragment, useRef, useState } from 'react'
import { Plus, Trash2, Copy, Eye, EyeOff, Lock, ImagePlus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ManualQuote, ManualQuoteColumn, ManualQuoteItem } from '@/lib/manual-quotes/store'
import { STD_LABEL, customIdOf, customKey, isInternal, type LayoutKey, type StdKey } from '@/lib/manual-quotes/layout'

const rid = () => `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`
export const blankItem = (ar: boolean): ManualQuoteItem => ({ id: rid(), description: '', details: '', quantity: 1, unit: ar ? 'م²' : 'm2', unit_price: null, imageUrl: null, notes: '', adminNotes: '', custom: {} })

const UNITS = ['m2', 'm', 'lm', 'pcs', 'set', 'lot', 'm3', 'kg', 'ton', 'م²', 'م.ط', 'عدد', 'طقم', 'مقطوعية']
const WIDTH: Partial<Record<StdKey, string>> = {
  image: 'w-16', description: 'min-w-[16rem]', details: 'min-w-[12rem]', quantity: 'w-24', unit: 'w-24',
  unit_price: 'w-28', total: 'w-28', notes: 'min-w-[10rem]', adminNotes: 'min-w-[12rem]',
}
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Patch = Pick<ManualQuote, 'columns' | 'layout' | 'hidden' | 'items'>

export function ManualQuoteGrid({ quote, ar, onChange, uploadImage }: {
  quote: Pick<ManualQuote, 'columns' | 'layout' | 'hidden' | 'items'>
  ar: boolean
  onChange: (patch: Partial<Patch>) => void
  uploadImage: (file: File) => Promise<string>
}) {
  const { columns, layout, hidden, items } = quote
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const fileFor = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const tx = (a: string, e: string) => (ar ? a : e)

  const colById = new Map(columns.map((c) => [c.id, c]))
  const label = (k: LayoutKey) => {
    const cid = customIdOf(k)
    return cid ? colById.get(cid)?.name || '' : STD_LABEL[k as StdKey][ar ? 'ar' : 'en']
  }

  // ── columns ──
  function insertColumn(at: number, internal: boolean) {
    if (columns.length >= 60) { toast.error(tx('الحد 60 عموداً', 'Max 60 columns')); return }
    const col: ManualQuoteColumn = { id: rid(), name: internal ? tx('عمود للإدارة', 'Admin column') : tx(`عمود ${columns.length + 1}`, `Column ${columns.length + 1}`), ...(internal ? { internal: true } : {}) }
    const next = layout.slice()
    next.splice(at, 0, customKey(col.id))
    onChange({ columns: [...columns, col], layout: next })
    setInsertAt(null)
  }
  function renameColumn(id: string, name: string) {
    onChange({ columns: columns.map((c) => (c.id === id ? { ...c, name } : c)) })
  }
  function removeColumn(id: string) {
    const used = items.some((it) => (it.custom?.[id] || '').trim())
    if (used && !window.confirm(tx('في العمود بيانات — حذفه يحذفها. متابعة؟', 'This column has data — delete it anyway?'))) return
    onChange({
      columns: columns.filter((c) => c.id !== id),
      layout: layout.filter((k) => k !== customKey(id)),
      items: items.map((it) => { if (!it.custom?.[id]) return it; const cu = { ...it.custom }; delete cu[id]; return { ...it, custom: cu } }),
    })
  }
  function toggleShown(k: LayoutKey) {
    if (k === 'adminNotes') return
    const cid = customIdOf(k)
    if (cid) { onChange({ columns: columns.map((c) => (c.id === cid ? { ...c, internal: !c.internal } : c)) }); return }
    const sk = k as StdKey
    onChange({ hidden: hidden.includes(sk) ? hidden.filter((h) => h !== sk) : [...hidden, sk] })
  }

  // ── rows ──
  const setItem = (id: string, patch: Partial<ManualQuoteItem>) => onChange({ items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })
  const setCustom = (id: string, colId: string, v: string) => onChange({ items: items.map((it) => (it.id === id ? { ...it, custom: { ...(it.custom || {}), [colId]: v } } : it)) })
  function insertRow(at: number) {
    const next = items.slice()
    next.splice(at, 0, blankItem(ar))
    onChange({ items: next })
  }
  function duplicateRow(i: number) {
    const next = items.slice()
    next.splice(i + 1, 0, { ...items[i], id: rid(), custom: { ...(items[i].custom || {}) } })
    onChange({ items: next })
  }
  function removeRow(id: string) { onChange({ items: items.filter((it) => it.id !== id) }) }

  // ── images ──
  async function putImage(itemId: string, file: File | null | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error(tx('الملف ليس صورة', 'Not an image')); return }
    setUploading(itemId)
    try {
      const url = await uploadImage(file)
      setItem(itemId, { imageUrl: url })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tx('فشل رفع الصورة', 'Image upload failed'))
    } finally {
      setUploading(null)
    }
  }

  // ── values / Excel-like paste ──
  const editable: LayoutKey[] = layout.filter((k) => k !== 'image' && k !== 'total')
  function writeCell(it: ManualQuoteItem, k: LayoutKey, raw: string): ManualQuoteItem {
    const cid = customIdOf(k)
    if (cid) return { ...it, custom: { ...(it.custom || {}), [cid]: raw } }
    const n = Number(String(raw).replace(/[,\s]/g, ''))
    switch (k) {
      case 'quantity': return { ...it, quantity: Number.isFinite(n) ? Math.max(0, n) : it.quantity }
      case 'unit_price': return { ...it, unit_price: raw.trim() === '' ? null : Number.isFinite(n) ? Math.max(0, n) : it.unit_price }
      case 'description': case 'details': case 'unit': case 'notes': case 'adminNotes': return { ...it, [k]: raw }
      default: return it
    }
  }
  function onPaste(e: React.ClipboardEvent, rowIdx: number, k: LayoutKey) {
    const text = e.clipboardData.getData('text/plain')
    if (!text || (!text.includes('\t') && !/\r?\n./.test(text.trimEnd()))) return // a single value — let the input handle it
    e.preventDefault()
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const startCol = editable.indexOf(k)
    if (startCol < 0) return
    const next = items.slice()
    grid.forEach((cells, dr) => {
      const r = rowIdx + dr
      if (!next[r]) next[r] = blankItem(ar)
      let it = next[r]
      cells.forEach((v, dc) => { const key = editable[startCol + dc]; if (key) it = writeCell(it, key, v.trim()) })
      next[r] = it
    })
    onChange({ items: next })
    toast.success(tx(`لُصق ${grid.length} صف`, `Pasted ${grid.length} row(s)`))
  }
  function onEnter(e: React.KeyboardEvent<HTMLElement>, rowIdx: number, k: LayoutKey) {
    if (e.key !== 'Enter' || e.shiftKey || (e.target as HTMLElement).tagName === 'TEXTAREA') return
    e.preventDefault()
    if (rowIdx === items.length - 1) insertRow(items.length)
    setTimeout(() => (document.querySelector(`[data-cell="${rowIdx + 1}:${k}"]`) as HTMLElement | null)?.focus(), 0)
  }

  const cellCls = 'w-full bg-transparent outline-none px-2 py-1.5 text-sm focus:bg-white focus:ring-2 focus:ring-teal-400 rounded-sm'
  const areaCls = `${cellCls} resize-none leading-snug`
  const autoGrow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px` } }

  function renderCell(it: ManualQuoteItem, i: number, k: LayoutKey) {
    const common = { 'data-cell': `${i}:${k}`, onPaste: (e: React.ClipboardEvent) => onPaste(e, i, k), onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => onEnter(e, i, k) }
    const cid = customIdOf(k)
    if (cid) return <input {...common} className={cellCls} value={it.custom?.[cid] || ''} onChange={(e) => setCustom(it.id, cid, e.target.value)} />
    switch (k as StdKey) {
      case 'image':
        return (
          <div
            className="relative w-14 h-14 mx-auto rounded-md border border-dashed bg-muted/30 flex items-center justify-center cursor-pointer overflow-hidden hover:bg-muted/60 focus:ring-2 focus:ring-teal-400 outline-none"
            tabIndex={0}
            title={tx('اضغط، أو اسحب صورة هنا، أو الصق صورة', 'Click, drop or paste an image')}
            onClick={() => { fileFor.current = it.id; fileInput.current?.click() }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void putImage(it.id, e.dataTransfer.files?.[0]) }}
            onPaste={(e) => { const f = Array.from(e.clipboardData.files || []).find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); void putImage(it.id, f) } }}
          >
            {uploading === it.id ? <Loader2 className="w-4 h-4 animate-spin" />
              // eslint-disable-next-line @next/next/no-img-element
              : it.imageUrl ? <img src={it.imageUrl} alt="" className="w-full h-full object-cover" />
              : <ImagePlus className="w-4 h-4 text-muted-foreground" />}
            {it.imageUrl && uploading !== it.id && (
              <button type="button" onClick={(e) => { e.stopPropagation(); setItem(it.id, { imageUrl: null }) }}
                className="absolute top-0 end-0 bg-white/90 rounded-bl p-0.5 text-muted-foreground hover:text-red-600" title={tx('إزالة الصورة', 'Remove image')}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )
      case 'description':
        return <textarea {...common} rows={1} ref={autoGrow} onInput={(e) => autoGrow(e.currentTarget)} className={`${areaCls} font-medium`} value={it.description} placeholder={tx('الوصف', 'Description')} onChange={(e) => setItem(it.id, { description: e.target.value })} />
      case 'details':
        return <textarea {...common} rows={1} ref={autoGrow} onInput={(e) => autoGrow(e.currentTarget)} className={`${areaCls} text-muted-foreground`} value={it.details} onChange={(e) => setItem(it.id, { details: e.target.value })} />
      case 'quantity':
        return <input {...common} type="number" min={0} step="any" dir="ltr" className={`${cellCls} text-end tabular-nums`} value={it.quantity} onChange={(e) => setItem(it.id, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
      case 'unit':
        return <input {...common} list="mq-units" className={cellCls} value={it.unit} onChange={(e) => setItem(it.id, { unit: e.target.value })} />
      case 'unit_price':
        return <input {...common} type="number" min={0} step="0.01" dir="ltr" className={`${cellCls} text-end tabular-nums`} value={it.unit_price ?? ''} onChange={(e) => setItem(it.id, { unit_price: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
      case 'total':
        return <div className="px-2 py-1.5 text-sm text-end tabular-nums font-semibold" dir="ltr">{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</div>
      case 'notes':
        return <textarea {...common} rows={1} ref={autoGrow} onInput={(e) => autoGrow(e.currentTarget)} className={areaCls} value={it.notes || ''} onChange={(e) => setItem(it.id, { notes: e.target.value })} />
      case 'adminNotes':
        return <textarea {...common} rows={1} ref={autoGrow} onInput={(e) => autoGrow(e.currentTarget)} className={areaCls} value={it.adminNotes || ''} placeholder={tx('للإدارة فقط', 'Management only')} onChange={(e) => setItem(it.id, { adminNotes: e.target.value })} />
    }
  }

  const PlusCol = ({ at }: { at: number }) => (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setInsertAt(insertAt === at ? null : at)} title={tx('إضافة عمود هنا', 'Insert a column here')}
        className="w-5 h-5 rounded-full text-teal-700 hover:bg-teal-100 flex items-center justify-center text-sm font-bold leading-none">+</button>
      {insertAt === at && (
        <span className="absolute top-6 start-0 z-30 flex flex-col gap-1 bg-white border rounded-md shadow-lg p-1.5 w-44 text-xs font-normal">
          <button type="button" onClick={() => insertColumn(at, false)} className="text-start px-2 py-1.5 rounded hover:bg-muted flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-teal-700" />{tx('عمود يظهر في العرض', 'Column on the quote')}</button>
          <button type="button" onClick={() => insertColumn(at, true)} className="text-start px-2 py-1.5 rounded hover:bg-amber-50 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-amber-700" />{tx('عمود للإدارة (مخفي)', 'Admin column (hidden)')}</button>
        </span>
      )}
    </span>
  )

  return (
    <div className="space-y-2">
      <datalist id="mq-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; const id = fileFor.current; e.target.value = ''; if (id) void putImage(id, f) }} />
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-50">
              <th className="w-14 border-b border-e px-1 py-2 text-xs text-muted-foreground font-medium">
                <div className="flex items-center justify-center gap-0.5">
                  #
                  <button type="button" onClick={() => insertRow(0)} title={tx('إضافة صف في الأعلى', 'Insert a row at the top')} className="w-5 h-5 rounded-full text-teal-700 hover:bg-teal-100 text-sm font-bold leading-none">+</button>
                </div>
              </th>
              {layout.map((k, ci) => {
                const internal = isInternal(k, columns, hidden)
                const cid = customIdOf(k)
                const fixedInternal = k === 'adminNotes'
                return (
                  <Fragment key={k}>
                    <th className={`border-b border-e px-1 py-1.5 align-top font-medium ${WIDTH[k as StdKey] || 'min-w-[9rem]'} ${internal ? 'bg-amber-50' : ''}`}>
                      <div className="flex items-start gap-0.5">
                        <PlusCol at={ci} />
                        <div className="flex-1 min-w-0">
                          {cid ? (
                            <input value={label(k)} onChange={(e) => renameColumn(cid, e.target.value)} className="w-full bg-transparent outline-none text-xs font-semibold px-1 py-0.5 rounded focus:bg-white focus:ring-1 focus:ring-teal-400" />
                          ) : (
                            <span className="block text-xs font-semibold px-1 py-0.5 truncate">{label(k)}</span>
                          )}
                          <div className="flex items-center gap-1 px-1 mt-0.5">
                            {fixedInternal ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-800"><Lock className="w-3 h-3" />{tx('للإدارة', 'Admin')}</span>
                            ) : (
                              <button type="button" onClick={() => toggleShown(k)} className={`inline-flex items-center gap-0.5 text-[10px] rounded px-1 ${internal ? 'text-amber-800 hover:bg-amber-100' : 'text-teal-700 hover:bg-teal-50'}`}
                                title={internal ? tx('لا يظهر في العرض — اضغط لإظهاره', 'Not on the quote — click to show') : tx('يظهر في العرض — اضغط لإخفائه', 'On the quote — click to hide')}>
                                {internal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                {internal ? (cid ? tx('للإدارة', 'Admin') : tx('مخفي', 'Hidden')) : tx('في العرض', 'On quote')}
                              </button>
                            )}
                            {cid && (
                              <button type="button" onClick={() => removeColumn(cid)} title={tx('حذف العمود', 'Delete column')} className="text-muted-foreground hover:text-red-600 ms-auto"><Trash2 className="w-3 h-3" /></button>
                            )}
                          </div>
                        </div>
                        {ci === layout.length - 1 && <PlusCol at={ci + 1} />}
                      </div>
                    </th>
                  </Fragment>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={layout.length + 1} className="text-center text-muted-foreground py-8 text-sm">
                {tx('لا بنود بعد — أضف صفاً، أو ارفع ملفاً، أو الصق من إكسل في أي خانة', 'No items yet — add a row, upload a file, or paste from Excel into any cell')}
              </td></tr>
            )}
            {items.map((it, i) => (
              <tr key={it.id} className="group align-top hover:bg-slate-50/60">
                <td className="border-b border-e px-1 py-1 text-center">
                  <div className="text-xs text-muted-foreground tabular-nums">{i + 1}</div>
                  <div className="flex items-center justify-center gap-0.5 mt-0.5 opacity-40 group-hover:opacity-100 transition">
                    <button type="button" onClick={() => insertRow(i + 1)} title={tx('إضافة صف بعده', 'Insert a row below')} className="w-5 h-5 rounded-full text-teal-700 hover:bg-teal-100 text-sm font-bold leading-none">+</button>
                    <button type="button" onClick={() => duplicateRow(i)} title={tx('تكرار الصف', 'Duplicate row')} className="text-muted-foreground hover:text-teal-700"><Copy className="w-3 h-3" /></button>
                    <button type="button" onClick={() => removeRow(it.id)} title={tx('حذف الصف', 'Delete row')} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </td>
                {layout.map((k) => (
                  <td key={k} className={`border-b border-e p-0.5 ${isInternal(k, columns, hidden) ? 'bg-amber-50/50' : ''}`}>{renderCell(it, i, k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => insertRow(items.length)} className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline">
        <Plus className="w-4 h-4" />{tx('إضافة بند', 'Add item')}
      </button>
      <p className="text-[11px] text-muted-foreground">
        {tx('الأعمدة الصفراء للإدارة فقط ولا تظهر للعميل • Enter ينزل للصف التالي • الصق من إكسل في أي خانة يعبّي الجدول', 'Yellow columns are management-only • Enter moves down • paste from Excel into any cell to fill the table')}
      </p>
    </div>
  )
}
