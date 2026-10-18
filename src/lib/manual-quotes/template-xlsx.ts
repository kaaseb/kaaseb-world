// Build the KAASEB quotation Excel template (server-side, exceljs): styled,
// bilingual, with dropdowns, number formats, live line totals and a live
// totals box — blank, or pre-filled from an existing quote so the team can
// work on it in Excel and upload it back (see lib/manual-quotes/import).

import ExcelJS from 'exceljs'
import { TEMPLATE_MARKER, KEYS_ROW_MARK, TEMPLATE_ROWS, INFO_FIELDS, ITEM_FIELDS, UNIT_CHOICES, type ItemField } from './template-spec'
import type { ManualQuote } from './store'

const BRAND = 'FF0F766E'      // teal-700
const HEAD_FILL = 'FF134E4A'  // teal-900
const INTERNAL_FILL = 'FFFEF3C7' // amber-100
const INTERNAL_HEAD = 'FFB45309' // amber-700
const LABEL_FILL = 'FFF1F5F9' // slate-100
const GRID = 'FFCBD5E1'       // slate-300

const thin = { style: 'thin' as const, color: { argb: GRID } }
const box = { top: thin, left: thin, bottom: thin, right: thin }

function colLetter(n: number): string {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const DELIVERY_LABEL = { none: 'بدون', included: 'شامل', excluded: 'غير شامل' } as const

export async function buildQuoteTemplate(quote?: ManualQuote | null, opts: { lang?: 'ar' | 'en' } = {}): Promise<Buffer> {
  const lang = quote?.language || opts.lang || 'ar'
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KAASEB'
  wb.created = new Date()
  const ws = wb.addWorksheet('Quotation', {
    views: [{ rightToLeft: lang === 'ar', showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })

  // ── columns: A hidden (machine keys), then the item fields (+ quote extras) ──
  const fields: Array<ItemField & { extraKey?: string }> = [...ITEM_FIELDS]
  // Existing custom columns that are not one of our detail fields travel too.
  const detailNames = new Map<string, ItemField>()
  for (const f of ITEM_FIELDS) if (f.column) { detailNames.set(f.column.ar.toLowerCase(), f); detailNames.set(f.column.en.toLowerCase(), f) }
  const extraCols = (quote?.columns || []).filter((c) => !detailNames.has(c.name.trim().toLowerCase()))
  for (const c of extraCols) {
    fields.push({ key: 'notes', header: `${c.name}${c.internal ? '\n— داخلي / internal' : ''}`, width: 18, internal: !!c.internal, extraKey: `${c.internal ? 'admin' : 'col'}:${c.name}` })
  }
  ws.getColumn(1).width = 4
  ws.getColumn(1).hidden = true
  fields.forEach((f, i) => { ws.getColumn(i + 2).width = f.width })
  const colOf = (key: string) => fields.findIndex((f) => !f.extraKey && f.key === key) + 2

  // ── title ──
  ws.getCell('A1').value = TEMPLATE_MARKER
  ws.mergeCells(1, 2, 1, Math.min(fields.length + 1, 9))
  const title = ws.getCell(1, 2)
  title.value = quote ? `KAASEB — عرض سعر / Quotation  #${quote.number}` : 'KAASEB — قالب عرض سعر / Quotation template'
  title.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  title.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 34
  ws.mergeCells(2, 2, 2, Math.min(fields.length + 1, 9))
  const hint = ws.getCell(2, 2)
  hint.value = 'عبّئ الخانات البيضاء • الأعمدة الصفراء داخلية لا تظهر للعميل • ارفع الملف من «العروض اليدوية ← رفع ملف»   |   Fill the white cells • Yellow columns are internal • Upload via Manual quotes → Upload file'
  hint.font = { size: 10, italic: true, color: { argb: 'FF475569' } }
  hint.alignment = { wrapText: true, vertical: 'middle' }
  ws.getRow(2).height = 30

  // ── info block (rows 4…) + live totals box ──
  const INFO_START = 4
  const infoRow: Record<string, number> = {}
  INFO_FIELDS.forEach((f, i) => {
    const r = INFO_START + i
    infoRow[f.key] = r
    ws.getCell(r, 1).value = f.key
    const lab = ws.getCell(r, 2)
    lab.value = f.label
    lab.font = { bold: true, color: { argb: 'FF0F172A' } }
    lab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_FILL } }
    lab.border = box
    ws.mergeCells(r, 3, r, 5)
    const val = ws.getCell(r, 3)
    val.border = box
    val.alignment = { vertical: 'middle' }
    if (f.hint) val.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${f.hint.split(', ').join(',')}"`] }
  })
  if (quote) {
    const set = (k: string, v: string | number) => { ws.getCell(infoRow[k], 3).value = v }
    set('project_name', quote.project_name || '')
    set('company', quote.company || '')
    set('client_name', quote.client_name || '')
    set('email', quote.email || '')
    set('phone', quote.phone || '')
    set('subject', quote.subject || '')
    set('language', quote.language === 'ar' ? 'عربي' : 'English')
    set('currency', quote.currency)
    set('vat', Math.round((quote.vat_rate || 0) * 100))
    set('delivery', DELIVERY_LABEL[quote.delivery || 'none'])
    set('shipping', quote.shipping || 0)
  } else {
    ws.getCell(infoRow.language, 3).value = lang === 'ar' ? 'عربي' : 'English'
    ws.getCell(infoRow.currency, 3).value = 'SAR'
    ws.getCell(infoRow.vat, 3).value = 15
    ws.getCell(infoRow.delivery, 3).value = 'بدون'
    ws.getCell(infoRow.shipping, 3).value = 0
  }
  ws.getCell(infoRow.shipping, 3).numFmt = '#,##0.00'

  // ── item table ──
  const KEYS_ROW = INFO_START + INFO_FIELDS.length + 1
  const HEAD_ROW = KEYS_ROW + 1
  const FIRST = HEAD_ROW + 1
  const LAST = FIRST + Math.max(TEMPLATE_ROWS, (quote?.items.length || 0) + 50) - 1
  ws.getCell(KEYS_ROW, 1).value = KEYS_ROW_MARK
  ws.getRow(KEYS_ROW).hidden = true
  fields.forEach((f, i) => {
    ws.getCell(KEYS_ROW, i + 2).value = f.extraKey || f.key
    const h = ws.getCell(HEAD_ROW, i + 2)
    h.value = f.header
    h.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.internal ? INTERNAL_HEAD : HEAD_FILL } }
    h.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    h.border = box
  })
  ws.getRow(HEAD_ROW).height = 40

  const Q = colLetter(colOf('quantity'))
  const P = colLetter(colOf('unit_price'))
  const T = colLetter(colOf('total'))
  for (let r = FIRST; r <= LAST; r++) {
    fields.forEach((f, i) => {
      const cell = ws.getCell(r, i + 2)
      cell.border = box
      if (f.internal) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INTERNAL_FILL } }
      if (f.key === 'description' || f.key === 'details' || f.key === 'notes' || f.key === 'adminNotes') cell.alignment = { wrapText: true, vertical: 'top' }
    })
    ws.getCell(`${Q}${r}`).numFmt = '#,##0.###'
    ws.getCell(`${P}${r}`).numFmt = '#,##0.00'
    const tc = ws.getCell(`${T}${r}`)
    tc.value = { formula: `IF(AND(ISNUMBER(${Q}${r}),ISNUMBER(${P}${r})),${Q}${r}*${P}${r},"")` }
    tc.numFmt = '#,##0.00'
    tc.font = { bold: true }
    tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    const costCol = colOf('cost')
    if (costCol > 1) ws.getCell(r, costCol).numFmt = '#,##0.00'
    ws.getCell(r, colOf('unit')).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`"${UNIT_CHOICES.join(',')}"`] }
    ws.getCell(r, colOf('no')).value = r - FIRST + 1
    ws.getCell(r, colOf('no')).font = { color: { argb: 'FF94A3B8' } }
    ws.getCell(r, colOf('no')).alignment = { horizontal: 'center' }
  }

  // Pre-fill from the quote.
  if (quote) {
    const byName = new Map(quote.columns.map((c) => [c.id, c]))
    quote.items.forEach((it, idx) => {
      const r = FIRST + idx
      const put = (key: string, v: string | number | null | undefined) => { const c = colOf(key); if (c > 1 && v !== null && v !== undefined && v !== '') ws.getCell(r, c).value = v }
      put('description', it.description)
      put('details', it.details)
      put('quantity', Number(it.quantity) || 0)
      put('unit', it.unit)
      if (it.unit_price !== null) put('unit_price', Number(it.unit_price))
      put('notes', it.notes || '')
      put('adminNotes', it.adminNotes || '')
      put('image', it.imageUrl || '')
      for (const [cid, v] of Object.entries(it.custom || {})) {
        const col = byName.get(cid)
        if (!col || !v) continue
        const detail = detailNames.get(col.name.trim().toLowerCase())
        const idxField = detail ? colOf(detail.key) : fields.findIndex((f) => f.extraKey === `${col.internal ? 'admin' : 'col'}:${col.name}`) + 2
        if (idxField > 1) ws.getCell(r, idxField).value = v
      }
    })
  }

  // Live totals box beside the info block.
  const range = `${T}${FIRST}:${T}${LAST}`
  const vatRef = `$C$${infoRow.vat}`
  const delRef = `$C$${infoRow.delivery}`
  const shipRef = `$C$${infoRow.shipping}`
  const boxCol = 7
  const lines: Array<[string, string]> = [
    ['المجموع / Subtotal', `SUM(${range})`],
    ['التوصيل / Delivery', `IF(${delRef}="غير شامل",N(${shipRef}),0)`],
    ['الضريبة / VAT', `(SUM(${range})+IF(${delRef}="غير شامل",N(${shipRef}),0))*IF(N(${vatRef})>1,N(${vatRef})/100,N(${vatRef}))`],
    ['الإجمالي / Grand total', `SUM(${range})+IF(${delRef}="غير شامل",N(${shipRef}),0)+(SUM(${range})+IF(${delRef}="غير شامل",N(${shipRef}),0))*IF(N(${vatRef})>1,N(${vatRef})/100,N(${vatRef}))`],
  ]
  lines.forEach(([label, formula], i) => {
    const r = INFO_START + i
    const l = ws.getCell(r, boxCol)
    l.value = label
    l.font = { bold: true, color: { argb: i === 3 ? 'FFFFFFFF' : 'FF0F172A' } }
    l.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 3 ? BRAND : LABEL_FILL } }
    l.border = box
    const v = ws.getCell(r, boxCol + 1)
    v.value = { formula }
    v.numFmt = '#,##0.00'
    v.font = { bold: true, size: i === 3 ? 13 : 11, color: { argb: i === 3 ? 'FFFFFFFF' : 'FF0F172A' } }
    v.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 3 ? BRAND : 'FFFFFFFF' } }
    v.border = box
  })

  ws.views = [{ rightToLeft: lang === 'ar', showGridLines: false, state: 'frozen', ySplit: HEAD_ROW, xSplit: 0 }]
  ws.autoFilter = { from: { row: HEAD_ROW, column: 2 }, to: { row: HEAD_ROW, column: fields.length + 1 } }

  // ── guide sheet ──
  const g = wb.addWorksheet('تعليمات - Guide', { views: [{ rightToLeft: true, showGridLines: false }] })
  g.getColumn(1).width = 110
  const guide = [
    ['طريقة الاستخدام', true],
    ['1) عبّئ بيانات العرض في الأعلى (المشروع، الشركة، المهندس…). اللغة والعملة والضريبة والتوصيل من القوائم المنسدلة.', false],
    ['2) اكتب البنود في الجدول: كل تفصيلة في عمودها (السماكة، التشطيب، المقاس، اللون، المادة). الإجمالي يُحسب تلقائياً.', false],
    ['3) الأعمدة الصفراء (ملاحظات الإدارة، سعر الشراء، المصدر) داخلية: تُحفظ في النظام ولا تظهر للعميل أبداً.', false],
    ['4) تقدر تضيف عموداً جديداً في أي مكان: يُنقل كما هو كعمود في العرض. إذا كتبت في عنوانه «داخلي» يصير للإدارة فقط.', false],
    ['5) احفظ الملف، ثم في عالم كاسب: العروض اليدوية ← افتح العرض ← «رفع ملف» ← اسحب الملف. كل شيء ينزل في مكانه.', false],
    ['6) لا تغيّر الخلية A1 ولا العمود المخفي A — بهما يتعرّف النظام على القالب.', false],
    ['', false],
    ['How to use', true],
    ['1) Fill the quote details at the top. Language, currency, VAT and delivery are dropdowns.', false],
    ['2) One item per row; every detail in its own column. Totals are calculated.', false],
    ['3) Yellow columns are internal (admin notes, purchase price, source): saved, never shown to the client.', false],
    ['4) Insert extra columns anywhere; put "internal" in the title to keep one for management only.', false],
    ['5) Save, then in KAASEB World: Manual quotes → open the quote → "Upload file" → drop the file.', false],
  ] as const
  guide.forEach(([text, bold], i) => {
    const c = g.getCell(i + 1, 1)
    c.value = text
    c.font = bold ? { bold: true, size: 14, color: { argb: BRAND } } : { size: 11 }
    c.alignment = { wrapText: true, vertical: 'middle' }
    g.getRow(i + 1).height = bold ? 26 : 22
  })

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
