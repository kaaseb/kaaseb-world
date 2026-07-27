'use client'

// Print layout for a manual quote — auto-fires window.print() on mount so the
// browser produces a clean PDF (same UX as the Furn quotation print page).

import { useEffect } from 'react'
import type { ManualQuote } from '@/lib/manual-quotes/store'

export function ManualQuotePrint({ quote: q }: { quote: ManualQuote }) {
  const ar = q.language === 'ar'
  useEffect(() => { const t = setTimeout(() => window.print(), 700); return () => clearTimeout(t) }, [])

  const subtotal = q.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  const vat = subtotal * (q.vat_rate || 0)
  const total = subtotal + vat
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const t = (a: string, e: string) => (ar ? a : e)

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ fontFamily: 'Tajawal, Arial, sans-serif', color: '#111827', maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <style>{`@media print { @page { margin: 14mm; } button { display: none } } * { box-sizing: border-box }`}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0d9488', paddingBottom: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>KAASEB — {t('كاسب / أبراج العاصمة للرخام والجرانيت', 'Capital Tower / Abraj Al-Asima for Marble & Granite')}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>kaaseb.sa · info@kaaseb.sa · +966 50 626 8080</div>
        </div>
        <div style={{ textAlign: ar ? 'left' : 'right' as const }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{t('عرض سعر', 'Quotation')} #{q.number}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(q.createdAt).toLocaleDateString(ar ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' })}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, marginBottom: 12 }}>
        {q.company && <div><strong>{t('الشركة', 'Company')}:</strong> {q.company}</div>}
        {q.client_name && <div><strong>{t('العميل', 'Contact')}:</strong> {q.client_name}</div>}
        {(q.email || q.phone) && <div style={{ color: '#6b7280' }}>{[q.email, q.phone].filter(Boolean).join(' · ')}</div>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={{ padding: 6, textAlign: 'start' as const, width: 28 }}>#</th>
            <th style={{ padding: 6, textAlign: 'start' as const, width: 54 }}></th>
            <th style={{ padding: 6, textAlign: 'start' as const }}>{t('البند', 'Item')}</th>
            <th style={{ padding: 6, textAlign: 'start' as const, width: 60 }}>{t('الكمية', 'Qty')}</th>
            <th style={{ padding: 6, textAlign: 'start' as const, width: 50 }}>{t('الوحدة', 'Unit')}</th>
            <th style={{ padding: 6, textAlign: 'end' as const, width: 80 }}>{t('السعر', 'Price')}</th>
            <th style={{ padding: 6, textAlign: 'end' as const, width: 90 }}>{t('الإجمالي', 'Total')}</th>
          </tr>
        </thead>
        <tbody>
          {q.items.map((it, i) => (
            <tr key={it.id} style={{ borderBottom: '1px solid #e5e7eb', pageBreakInside: 'avoid' }}>
              <td style={{ padding: 6, color: '#6b7280' }}>{i + 1}</td>
              <td style={{ padding: 6 }}>
                {it.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={it.imageUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4 }} />
                  : null}
              </td>
              <td style={{ padding: 6 }}>
                <div style={{ fontWeight: 600 }}>{it.description}</div>
                {it.details && <div style={{ fontSize: 11, color: '#6b7280' }}>{it.details}</div>}
              </td>
              <td style={{ padding: 6 }}>{it.quantity}</td>
              <td style={{ padding: 6 }}>{it.unit}</td>
              <td style={{ padding: 6, textAlign: 'end' as const }}>{it.unit_price != null ? money(it.unit_price) : '—'}</td>
              <td style={{ padding: 6, textAlign: 'end' as const, fontWeight: 600 }}>{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: ar ? 'flex-start' : 'flex-end' }}>
        <table style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ padding: '2px 16px', color: '#6b7280' }}>{t('المجموع', 'Subtotal')}</td><td style={{ padding: '2px 0', textAlign: 'end' as const }}>{money(subtotal)}</td></tr>
            <tr><td style={{ padding: '2px 16px', color: '#6b7280' }}>{t('الضريبة', 'VAT')} {(q.vat_rate * 100).toFixed(0)}%</td><td style={{ padding: '2px 0', textAlign: 'end' as const }}>{money(vat)}</td></tr>
            <tr style={{ fontWeight: 700, fontSize: 15 }}><td style={{ padding: '4px 16px' }}>{t('الإجمالي', 'Total')}</td><td style={{ padding: '4px 0', textAlign: 'end' as const }}>{money(total)} {q.currency}</td></tr>
          </tbody>
        </table>
      </div>

      {q.notes && <div style={{ marginTop: 16, fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap' }}><strong>{t('ملاحظات', 'Notes')}:</strong> {q.notes}</div>}
    </div>
  )
}
