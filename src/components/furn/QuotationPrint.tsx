'use client'

// Professional bilingual quotation print page.
// Renders RTL Arabic or LTR English depending on the quotation's `language`
// field. Auto-fires window.print() on mount so the browser produces a clean
// downloadable PDF.
//
// Design choices (per stakeholder spec):
//   • Olive-dark primary palette (think field/oak rather than pure black).
//   • Header is a single image uploaded in Settings, sized for 800×350 px.
//   • No project_number / engineer phone / manager block in the document —
//     they're internal-only.
//   • Project name + offer date live inside the same data card as the
//     other fields (no separate banner date).
//   • Notes column on the items table only shows when at least one item
//     actually has a note worth printing.
//   • Bilingual terms — pick the matching-language column, fall back to
//     the legacy single-language value, fall back to settings defaults.

import { useEffect } from 'react'
import { Printer } from 'lucide-react'
import type { FurnProject, FurnItem, FurnQuotation, FurnSettings } from '@/types'

interface Props {
  project: FurnProject
  items: FurnItem[]
  quotation: FurnQuotation
  settings: FurnSettings
  // Resolved "delivery included / not included" sentence for this quotation's
  // language, or null when the team chose not to show one. Computed server-side
  // from the delivery store (src/lib/furn/delivery-store).
  deliveryNote?: string | null
}

const STR = {
  ar: {
    quotation: 'عرض سعر',
    quotation_no: 'رقم العرض',
    date: 'تاريخ العرض السعري',
    company: 'اسم الشركة',
    project: 'اسم المشروع',
    engineer: 'اسم المهندس',
    subject: 'الموضوع',
    cr: 'السجل التجاري',
    tax: 'الرقم الضريبي',
    col_pos: '#',
    col_desc: 'الوصف / الصنف',
    col_qty: 'الكمية',
    col_unit: 'الوحدة',
    col_price: 'سعر الوحدة',
    col_total: 'المجموع',
    col_notes: 'ملاحظات',
    subtotal: 'الإجمالي',
    vat: 'الضريبة 15%',
    grand_total: 'المجموع الكلي شامل الضريبة',
    in_words: 'فقط',
    only_suffix: 'لا غير',
    payment_terms: 'شروط الدفع',
    delivery_terms: 'مدة التوريد',
    delivery_note: 'التوصيل',
    offer_duration: 'مدة العرض',
    special_conditions: 'شروط خاصة',
    callout_transport: 'السعر لا يشمل النقل أو التركيب — يُتفق عليهما لاحقاً.',
    callout_marble_only: 'السعر يشمل توريد الرخام/الجرانيت فقط ولا يشمل أي أعمال أخرى.',
    closing: 'نأمل أن يحوز عرضنا قبولكم ورضاكم.',
    print: 'طباعة / حفظ كـ PDF',
    sar: 'ر.س',
  },
  en: {
    quotation: 'Price Offer',
    quotation_no: 'Offer No.',
    date: 'Quotation date',
    company: 'Company',
    project: 'Project',
    engineer: 'Engineer',
    subject: 'Subject',
    cr: 'Commercial Register',
    tax: 'Tax Number',
    col_pos: '#',
    col_desc: 'Description / Item',
    col_qty: 'Qty',
    col_unit: 'Unit',
    col_price: 'Unit Price',
    col_total: 'Total',
    col_notes: 'Notes',
    subtotal: 'Subtotal',
    vat: 'VAT 15%',
    grand_total: 'Grand Total (incl. VAT)',
    in_words: 'In words:',
    only_suffix: 'only',
    payment_terms: 'Payment terms',
    delivery_terms: 'Delivery duration',
    delivery_note: 'Delivery',
    offer_duration: 'Offer validity',
    special_conditions: 'Special conditions',
    callout_transport: 'Price excludes transportation and installation — both to be agreed separately.',
    callout_marble_only: 'Price covers supply of marble/granite only; no other works are included.',
    closing: 'We trust this offer meets your satisfaction and approval.',
    print: 'Print / Save as PDF',
    sar: 'SAR',
  },
} as const

function formatMoney(n: number): string {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function arabicAmountInWords(amount: number): string {
  const sar = Math.floor(amount)
  const halalas = Math.round((amount - sar) * 100)
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر']
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون']
  const hundreds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة']
  function under1000(n: number): string {
    if (n === 0) return ''
    const h = Math.floor(n / 100)
    const r = n % 100
    let out = hundreds[h]
    if (r > 0) {
      const part = r < 20 ? ones[r] : (r % 10 === 0 ? tens[Math.floor(r / 10)] : `${ones[r % 10]} و${tens[Math.floor(r / 10)]}`)
      out = out ? `${out} و${part}` : part
    }
    return out
  }
  if (sar >= 1_000_000) return `${formatMoney(amount)} ريال سعودي`
  let out = ''
  if (sar >= 1000) {
    const thousands = Math.floor(sar / 1000)
    const rest = sar % 1000
    const tWord = thousands === 1 ? 'ألف' : thousands === 2 ? 'ألفان' : thousands < 11 ? `${under1000(thousands)} آلاف` : `${under1000(thousands)} ألفاً`
    out = tWord
    if (rest > 0) out += ` و${under1000(rest)}`
  } else {
    out = under1000(sar) || 'صفر'
  }
  out += ' ريال سعودي'
  if (halalas > 0) out += ` و${under1000(halalas)} هللة`
  return out
}

function englishAmountInWords(amount: number): string {
  const sar = Math.floor(amount)
  const halalas = Math.round((amount - sar) * 100)
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  function under100(n: number): string {
    if (n < 20) return ones[n]
    const t = Math.floor(n / 10)
    const r = n % 10
    return r ? `${tens[t]}-${ones[r]}` : tens[t]
  }
  function under1000(n: number): string {
    if (n === 0) return ''
    const h = Math.floor(n / 100)
    const r = n % 100
    return h
      ? r ? `${ones[h]} hundred ${under100(r)}` : `${ones[h]} hundred`
      : under100(r)
  }
  if (sar >= 1_000_000) return `${formatMoney(amount)} Saudi Riyals`
  let out = ''
  if (sar >= 1000) {
    const thousands = Math.floor(sar / 1000)
    const rest = sar % 1000
    out = `${under1000(thousands)} thousand`
    if (rest > 0) out += ` ${under1000(rest)}`
  } else {
    out = under1000(sar) || 'zero'
  }
  out = out.trim() + ' Saudi Riyals'
  if (halalas > 0) out += ` and ${under100(halalas)} halalas`
  return out
}

// Pick the bilingual variant for a terms field, with two levels of
// fallback: the legacy single-language value (older quotations stored
// only one), then the global settings default.
function pickTerm(
  lang: 'ar' | 'en',
  enValue: string | null,
  arValue: string | null,
  legacy: string | null,
  fallback: string | null,
): string | null {
  const langValue = lang === 'en' ? enValue : arValue
  return (langValue || legacy || fallback || '').trim() || null
}

export function QuotationPrint({ project, items, quotation, settings, deliveryNote }: Props) {
  const lang = quotation.language === 'en' ? 'en' : 'ar'
  const isRtl = lang === 'ar'
  const S = STR[lang]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr'
    const t = setTimeout(() => window.print(), 800)
    return () => clearTimeout(t)
  }, [lang, isRtl])

  const subtotal = Number(quotation.subtotal)
  const vatAmount = Number(quotation.vat_amount)
  const total = Number(quotation.total)

  const paymentTerms     = pickTerm(lang, project.payment_terms_en, project.payment_terms_ar, project.payment_terms, settings.default_payment_terms)
  const deliveryTerms    = pickTerm(lang, project.delivery_terms_en, project.delivery_terms_ar, project.delivery_terms, settings.default_delivery_terms)
  const offerDuration    = pickTerm(lang, project.offer_duration_en, project.offer_duration_ar, project.offer_duration, settings.default_offer_duration)
  const specialConditions= pickTerm(lang, project.special_conditions_en, project.special_conditions_ar, project.special_conditions, settings.default_special_conditions)

  // Latin digits in the date regardless of UI language — easier to read
  // and matches the spec the team is used to.
  const formattedDate = new Date(quotation.generated_at).toLocaleDateString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })

  const totalInWords = isRtl ? arabicAmountInWords(total) : englishAmountInWords(total)

  // Only render the notes column when at least one item actually has a
  // note. The AI fills `notes` for rows where finish/thickness/color
  // matters; empty rows shouldn't take up a column of whitespace.
  const showNotes = items.some(it => !!(it.notes && it.notes.trim()))

  return (
    <>
      {/* Print button shown on screen, hidden when actually printing */}
      <div className="no-print fixed top-4 end-4 z-50">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium shadow-lg transition"
        >
          <Printer className="w-4 h-4" />
          {S.print}
        </button>
      </div>

      <div className="quotation-page" dir={isRtl ? 'rtl' : 'ltr'}>
        {/* Header — single image from settings, designed for 800×350px.
            Fallback renders a clean branded block when nothing's uploaded. */}
        {settings.header_image_url ? (
          <div className="header-image">
            <img src={settings.header_image_url} alt="" />
          </div>
        ) : (
          <div className="header-fallback">
            <h2>KAASEB</h2>
            <p>FOR MARBLE &amp; GRANITE — للرخام والجرانيت</p>
          </div>
        )}

        {/* Quotation title — one inline line: "عرض سعر  #1701".
            Intentionally tight so the rest of the page has room to fit. */}
        <div className="title-strip">
          <span className="title-text">{S.quotation}</span>
          <span className="title-number-value">#{quotation.quotation_number}</span>
        </div>

        {/* Info card — every relevant field for the customer/project,
            tightly arranged in two columns. Project number, engineer
            phone, manager phone are intentionally absent. */}
        <div className="info-grid">
          <InfoRow label={S.project} value={project.project_name} />
          <InfoRow label={S.date} value={formattedDate} mono />
          <InfoRow label={S.company} value={project.company_name} />
          {project.engineer_name && <InfoRow label={S.engineer} value={project.engineer_name} />}
          {project.subject && <InfoRow label={S.subject} value={project.subject} wide />}
          {project.commercial_register && <InfoRow label={S.cr} value={project.commercial_register} mono />}
          {project.tax_number && <InfoRow label={S.tax} value={project.tax_number} mono />}
        </div>

        {/* Items table */}
        <table className="items-table">
          <thead>
            <tr>
              <th className="col-pos">{S.col_pos}</th>
              <th className="col-desc">{S.col_desc}</th>
              <th className="col-qty">{S.col_qty}</th>
              <th className="col-unit">{S.col_unit}</th>
              <th className="col-price">{S.col_price}</th>
              <th className="col-total">{S.col_total}</th>
              {showNotes && <th className="col-notes">{S.col_notes}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const lineTotal = Number(it.quantity || 0) * Number(it.unit_price || 0)
              const detailsText = (it.details || '').trim()
              return (
                <tr key={it.id}>
                  <td className="col-pos">{idx + 1}</td>
                  {/* Description cell prints the short item title at the
                      normal cell font with the long `details` line below in
                      a smaller muted style. `notes` keeps its own column on
                      the right for anything the team flagged manually. */}
                  <td className="col-desc">
                    <div className="desc-title">{it.description}</div>
                    {detailsText && <div className="desc-details">{detailsText}</div>}
                  </td>
                  <td className="col-qty">{Number(it.quantity).toLocaleString('en-US')}</td>
                  <td className="col-unit">{it.unit}</td>
                  <td className="col-price">{formatMoney(Number(it.unit_price || 0))}</td>
                  <td className="col-total">{formatMoney(lineTotal)}</td>
                  {showNotes && <td className="col-notes">{it.notes || ''}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="totals">
          <div className="totals-row">
            <span className="totals-label">{S.subtotal}</span>
            <span className="totals-value">{formatMoney(subtotal)} {S.sar}</span>
          </div>
          <div className="totals-row">
            <span className="totals-label">{S.vat}</span>
            <span className="totals-value">{formatMoney(vatAmount)} {S.sar}</span>
          </div>
          <div className="totals-row totals-grand">
            <span className="totals-label">{S.grand_total}</span>
            <span className="totals-value">{formatMoney(total)} {S.sar}</span>
          </div>
        </div>

        {/* Total spelled out — works for both languages */}
        <div className="totals-words">
          <strong>{S.in_words}</strong> {totalInWords} {isRtl ? S.only_suffix : ''}
          {!isRtl && <em> {S.only_suffix}.</em>}
        </div>

        {/* Callouts */}
        <div className="callouts">
          <div className="callout">{S.callout_marble_only}</div>
          <div className="callout">{S.callout_transport}</div>
        </div>

        {/* Terms */}
        {(offerDuration || deliveryTerms || paymentTerms || specialConditions || deliveryNote) && (
          <div className="terms">
            {offerDuration && (
              <div className="term-row">
                <strong>{S.offer_duration}:</strong> <span>{offerDuration}</span>
              </div>
            )}
            {deliveryTerms && (
              <div className="term-row">
                <strong>{S.delivery_terms}:</strong> <span>{deliveryTerms}</span>
              </div>
            )}
            {paymentTerms && (
              <div className="term-row">
                <strong>{S.payment_terms}:</strong> <span>{paymentTerms}</span>
              </div>
            )}
            {specialConditions && (
              <div className="term-row term-special">
                <strong>{S.special_conditions}:</strong> <span>{specialConditions}</span>
              </div>
            )}
            {deliveryNote && (
              <div className="term-row">
                <strong>{S.delivery_note}:</strong> <span>{deliveryNote}</span>
              </div>
            )}
          </div>
        )}

        <p className="closing">{S.closing}</p>

        {/* Seal sits on its own — no manager name, no signature image,
            no phone number. The PDF is intentionally clean. */}
        {settings.seal_image_url && (
          <div className="seal-wrap">
            <div className="seal-img"><img src={settings.seal_image_url} alt="" /></div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          {settings.footer_address && <div className="footer-address">{settings.footer_address}</div>}
          <div className="footer-row">
            {settings.commercial_register && <span>{S.cr}: {settings.commercial_register}</span>}
            {settings.tax_number && <span>{S.tax}: {settings.tax_number}</span>}
            {settings.company_phone && <span dir="ltr">{isRtl ? 'جوال' : 'Phone'}: {settings.company_phone}</span>}
            {settings.company_email && <span dir="ltr">{isRtl ? 'الإيميل' : 'Email'}: {settings.company_email}</span>}
          </div>
        </div>
      </div>

      <style jsx global>{`
        /* Olive-dark palette per spec. Primary is a deep oak/olive,
           accent is a softer mustard. Body stays near-black for legibility. */
        :root {
          --q-olive:   #3a4419;
          --q-olive-2: #4f5a2a;
          --q-accent:  #b8a045;
          --q-accent-2:#d8c270;
          --q-ink:     #1a1f15;
          --q-soft:    #f7f5ec;
          --q-line:    #d9d4bf;
          --q-mute:    #6a6856;
          --q-soft-hi: #fbfaf0;
        }

        /* Compact density target: a 5-item quotation should fit comfortably
           on one A4 page. Padding, font sizes, and line-heights are all
           tightened from the previous draft. Header image stays generous
           because that's the brand statement. */
        @page {
          size: A4;
          margin: 8mm 8mm;
        }
        body {
          margin: 0;
          background: #f0eee3;
          color: var(--q-ink);
          font-family: var(--font-tajawal), 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .no-print { display: block; }
        @media print {
          body { background: white; }
          .no-print { display: none !important; }
        }

        .quotation-page {
          max-width: 210mm;
          margin: 0 auto;
          padding: 10mm 10mm;
          background: white;
          box-sizing: border-box;
          font-size: 9pt;
          line-height: 1.35;
          position: relative;
        }
        @media print { .quotation-page { padding: 0; box-shadow: none; } }

        /* Header image: targeted for 800x350 — render at 100% width so
           the page footprint stays consistent regardless of aspect. */
        .header-image {
          width: 100%;
          margin-bottom: 8px;
          text-align: center;
        }
        .header-image img {
          width: 100%;
          max-width: 800px;
          height: auto;
          object-fit: contain;
        }
        .header-fallback {
          background: linear-gradient(135deg, var(--q-olive), var(--q-olive-2));
          color: #fafafa;
          padding: 14px 18px;
          border-radius: 6px;
          text-align: center;
          margin-bottom: 10px;
          position: relative;
        }
        .header-fallback::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--q-accent), var(--q-accent-2), var(--q-accent));
          border-radius: 0 0 6px 6px;
        }
        .header-fallback h2 {
          font-size: 20pt;
          letter-spacing: 6px;
          margin: 0;
          font-weight: 800;
        }
        .header-fallback p {
          margin: 4px 0 0;
          font-size: 8pt;
          opacity: 0.85;
        }

        /* Compact title — one line, ~20px equivalent (≈ 11pt at default
           PDF scale). "عرض سعر #1701" sits together with a thin accent
           bar on the leading side. */
        .title-strip {
          position: relative;
          padding: 6px 12px;
          margin-bottom: 10px;
          background: var(--q-soft);
          border: 1px solid var(--q-line);
          border-radius: 4px;
          display: flex;
          align-items: baseline;
          gap: 10px;
          overflow: hidden;
        }
        .title-strip::before {
          content: '';
          position: absolute;
          top: 0; bottom: 0;
          inset-inline-start: 0;
          width: 3px;
          background: var(--q-accent);
        }
        .title-text {
          font-size: 11pt;
          font-weight: 800;
          color: var(--q-olive);
          letter-spacing: 1px;
        }
        .title-number-value {
          font-size: 11pt;
          font-weight: 700;
          color: var(--q-olive-2);
          font-family: 'JetBrains Mono', 'Courier New', monospace;
        }

        /* Info card — tighter grid, slimmer padding. */
        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 4px 8px;
          margin-bottom: 10px;
          padding: 8px;
          background: var(--q-soft);
          border: 1px solid var(--q-line);
          border-radius: 4px;
        }
        .info-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          padding: 3px 6px;
          background: white;
          border-${isRtl ? 'right' : 'left'}: 2px solid var(--q-accent);
          border-radius: 2px;
          font-size: 8.5pt;
        }
        .info-row-wide { grid-column: 1 / -1; }
        .info-label {
          font-weight: 700;
          color: var(--q-olive);
          min-width: 80px;
          font-size: 8pt;
        }
        .info-value {
          flex: 1;
          color: var(--q-ink);
          font-weight: 500;
        }
        .info-value-mono { font-family: 'JetBrains Mono', 'Courier New', monospace; }

        /* Items table — tighter rows, smaller header band. */
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 8px;
          font-size: 8.5pt;
          border: 1px solid var(--q-olive);
          border-radius: 3px;
          overflow: hidden;
        }
        .items-table th {
          background: var(--q-olive);
          color: white;
          font-weight: 600;
          padding: 5px 5px;
          text-align: center;
          border: 1px solid var(--q-olive-2);
          font-size: 8pt;
          letter-spacing: 0.2px;
        }
        .items-table td {
          padding: 4px 5px;
          border: 1px solid var(--q-line);
          vertical-align: top;
        }
        .items-table tr:nth-child(even) td {
          background: var(--q-soft-hi);
        }
        .col-pos { width: 26px; text-align: center; font-weight: 600; color: var(--q-olive); }
        .col-desc { text-align: start; min-width: 180px; }
        /* The title is the catalog item; details are the long descriptive
           line the AI extracted. Kept on its own line in a smaller muted
           type so the cell remains scannable even with 3–4 lines of detail. */
        .desc-title { font-weight: 600; color: var(--q-ink); }
        .desc-details {
          margin-top: 2px;
          font-size: 7.5pt;
          line-height: 1.3;
          color: var(--q-mute);
          white-space: pre-wrap;
        }
        .col-qty { width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
        .col-unit { width: 40px; text-align: center; }
        .col-price { width: 64px; text-align: end; font-variant-numeric: tabular-nums; }
        .col-total { width: 72px; text-align: end; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--q-olive); }
        .col-notes { width: 110px; font-size: 7.5pt; color: var(--q-mute); }

        /* Totals — slim, still visually anchored. */
        .totals {
          margin-${isRtl ? 'left' : 'right'}: 0;
          margin-${isRtl ? 'right' : 'left'}: auto;
          width: 55%;
          margin-bottom: 4px;
          border: 1px solid var(--q-line);
          border-radius: 4px;
          overflow: hidden;
        }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 10px;
          font-size: 9pt;
          background: var(--q-soft);
        }
        .totals-row + .totals-row { border-top: 1px solid var(--q-line); }
        .totals-grand {
          background: linear-gradient(135deg, var(--q-olive), var(--q-olive-2));
          color: white;
          font-size: 10pt;
          font-weight: 800;
          padding: 6px 10px;
          border-top: 2px solid var(--q-accent) !important;
          border-bottom: 2px solid var(--q-accent);
        }
        .totals-grand .totals-value { color: var(--q-accent-2); font-size: 11pt; }
        .totals-value { font-variant-numeric: tabular-nums; font-weight: 600; }
        .totals-label { color: var(--q-mute); }
        .totals-grand .totals-label { color: white; }

        .totals-words {
          margin: 4px 0 8px;
          padding: 5px 10px;
          background: var(--q-soft);
          border-${isRtl ? 'right' : 'left'}: 2px solid var(--q-accent);
          font-size: 8.5pt;
          color: var(--q-ink);
          border-radius: 2px;
          font-weight: 500;
        }
        .totals-words strong { margin-${isRtl ? 'left' : 'right'}: 4px; color: var(--q-olive); }

        .callouts {
          display: flex;
          flex-direction: column;
          gap: 3px;
          margin-bottom: 8px;
        }
        .callout {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
          padding: 4px 8px;
          font-size: 7.5pt;
          border-radius: 3px;
          font-weight: 500;
        }

        .terms {
          background: var(--q-soft);
          border: 1px solid var(--q-line);
          border-radius: 4px;
          padding: 6px 10px;
          margin-bottom: 8px;
          font-size: 8.5pt;
        }
        .term-row { padding: 2px 0; }
        .term-row strong { color: var(--q-olive); margin-${isRtl ? 'left' : 'right'}: 4px; }
        .term-special {
          margin-top: 3px;
          padding-top: 4px;
          border-top: 1px dashed var(--q-line);
          color: var(--q-mute);
        }

        .closing {
          text-align: center;
          font-style: italic;
          color: var(--q-mute);
          font-size: 8.5pt;
          margin: 8px 0 6px;
          padding: 0 10mm;
        }

        /* Compact seal block. */
        .seal-wrap {
          display: flex;
          justify-content: ${isRtl ? 'flex-start' : 'flex-end'};
          margin: 0 0 6px;
        }
        .seal-img {
          width: 70px;
          height: 70px;
        }
        .seal-img img {
          max-width: 70px;
          max-height: 70px;
          object-fit: contain;
          transform: rotate(-6deg);
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.12));
        }

        .footer {
          border-top: 1.5px solid var(--q-accent);
          background: linear-gradient(180deg, var(--q-soft), var(--q-soft-hi));
          margin-top: 6px;
          padding: 5px 10px;
          font-size: 7.5pt;
          color: var(--q-ink);
          text-align: center;
          border-radius: 3px;
        }
        .footer-address {
          font-weight: 600;
          margin-bottom: 2px;
        }
        .footer-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 2px 10px;
          color: var(--q-mute);
        }
        .footer-row span { white-space: nowrap; }
      `}</style>
    </>
  )
}

function InfoRow({ label, value, wide, mono }: {
  label: string
  value: string | number
  wide?: boolean
  mono?: boolean
}) {
  return (
    <div className={`info-row ${wide ? 'info-row-wide' : ''}`}>
      <div className="info-label">{label}</div>
      <div className={`info-value ${mono ? 'info-value-mono' : ''}`}>{value}</div>
    </div>
  )
}
