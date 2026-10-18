// The KAASEB quotation Excel template — ONE definition shared by the generator
// (server, exceljs) and the importer (browser, SheetJS), so a file the team
// downloads, fills in Excel and uploads lands field-for-field in the right place.
//
// Layout of the "Quotation" sheet:
//   column A (hidden) carries machine keys; nothing a user types there matters
//   A1                 = TEMPLATE_MARKER
//   info rows          = A: key   B: label   C: value      (E/F: live totals)
//   one hidden row     = A: "__keys__", B…: the item column keys
//   the header row     = the bilingual column titles
//   then the item rows
// A column the user INSERTS in Excel has an empty key → it becomes a custom
// column named after its header. Robust to reordering, renaming and new columns.

export const TEMPLATE_MARKER = 'KAASEB_QT_TEMPLATE_V1'
export const KEYS_ROW_MARK = '__keys__'
export const TEMPLATE_ROWS = 300

export type InfoKey = 'project_name' | 'company' | 'client_name' | 'email' | 'phone' | 'subject' | 'language' | 'currency' | 'vat' | 'delivery' | 'shipping'

export const INFO_FIELDS: Array<{ key: InfoKey; label: string; hint?: string }> = [
  { key: 'project_name', label: 'اسم المشروع / Project' },
  { key: 'company', label: 'الشركة / Company' },
  { key: 'client_name', label: 'المهندس / Contact' },
  { key: 'email', label: 'البريد / Email' },
  { key: 'phone', label: 'الجوال / Phone' },
  { key: 'subject', label: 'الموضوع / Subject' },
  { key: 'language', label: 'لغة العرض / Language', hint: 'عربي, English' },
  { key: 'currency', label: 'العملة / Currency', hint: 'SAR, USD' },
  { key: 'vat', label: 'الضريبة % / VAT %', hint: '15, 0' },
  { key: 'delivery', label: 'التوصيل / Delivery', hint: 'بدون, شامل, غير شامل' },
  { key: 'shipping', label: 'قيمة التوصيل / Delivery amount' },
]

export type ItemKey =
  | 'no' | 'description' | 'details' | 'thickness' | 'finish' | 'size' | 'colour' | 'material'
  | 'quantity' | 'unit' | 'unit_price' | 'total' | 'notes' | 'adminNotes' | 'cost' | 'source' | 'image'

export interface ItemField {
  key: ItemKey
  header: string
  width: number
  /** Management-only (styled differently, never printed). */
  internal?: boolean
  /** Name of the quote column this becomes, per quote language (detail fields). */
  column?: { ar: string; en: string }
}

export const ITEM_FIELDS: ItemField[] = [
  { key: 'no', header: '#', width: 6 },
  { key: 'description', header: 'الوصف\nDescription', width: 40 },
  { key: 'details', header: 'تفاصيل إضافية\nDetails', width: 30 },
  { key: 'thickness', header: 'السماكة (مم)\nThickness (mm)', width: 13, column: { ar: 'السماكة (مم)', en: 'Thickness (mm)' } },
  { key: 'finish', header: 'التشطيب\nFinish', width: 15, column: { ar: 'التشطيب', en: 'Finish' } },
  { key: 'size', header: 'المقاس\nSize', width: 16, column: { ar: 'المقاس', en: 'Size' } },
  { key: 'colour', header: 'اللون\nColour', width: 16, column: { ar: 'اللون', en: 'Colour' } },
  { key: 'material', header: 'المادة\nMaterial', width: 16, column: { ar: 'المادة', en: 'Material' } },
  { key: 'quantity', header: 'الكمية\nQty', width: 11 },
  { key: 'unit', header: 'الوحدة\nUnit', width: 10 },
  { key: 'unit_price', header: 'سعر الوحدة\nUnit price', width: 14 },
  { key: 'total', header: 'الإجمالي\nTotal', width: 16 },
  { key: 'notes', header: 'ملاحظات (تظهر للعميل)\nNotes (client)', width: 26 },
  { key: 'adminNotes', header: 'ملاحظات الإدارة — داخلي\nAdmin notes — internal', width: 28, internal: true },
  { key: 'cost', header: 'سعر الشراء — داخلي\nPurchase price — internal', width: 16, internal: true, column: { ar: 'سعر الشراء', en: 'Purchase price' } },
  { key: 'source', header: 'المصدر — داخلي\nSource — internal', width: 18, internal: true, column: { ar: 'المصدر', en: 'Source' } },
  { key: 'image', header: 'رابط الصورة (اختياري)\nImage link (optional)', width: 22 },
]

export const UNIT_CHOICES = ['m2', 'm', 'lm', 'pcs', 'set', 'lot', 'm3', 'kg', 'ton', 'م2', 'م.ط', 'عدد', 'طقم', 'مقطوعية']
