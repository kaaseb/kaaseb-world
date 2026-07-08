'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, CreditCard } from 'lucide-react'
import type { Profile } from '@/types'

interface Payment {
  id: string
  name: string
  amount: number
  payment_type: 'monthly' | 'annual' | 'one_time'
  department_name: string
  status: 'active' | 'paused' | 'due'
  last_paid_at: string | null
  note: string | null
  card_holder: string | null
  card_last4: string | null
}

const TYPE_LABELS: Record<string, string> = {
  monthly: 'شهري',
  annual: 'سنوي',
  one_time: 'مرة واحدة',
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-gray-100 text-gray-600',
  due: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'شغال',
  paused: 'موقف مؤقتاً',
  due: 'يستحق الدفع',
}

function calcNextPayment(lastPaidAt: string | null, type: string): Date | null {
  if (!lastPaidAt || type === 'one_time') return null
  const d = new Date(lastPaidAt)
  if (type === 'monthly') d.setMonth(d.getMonth() + 1)
  else if (type === 'annual') d.setFullYear(d.getFullYear() + 1)
  return d
}

function nextPaymentInfo(next: Date | null): { cellClass: string; textClass: string; label: string } {
  if (!next) return { cellClass: '', textClass: 'text-gray-400', label: '—' }
  const now = new Date()
  const diffDays = (next.getTime() - now.getTime()) / 86400000
  const label = next.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })
  if (diffDays <= 7) return { cellClass: 'bg-red-50', textClass: 'text-red-700 font-semibold', label }
  if (diffDays <= 14) return { cellClass: 'bg-amber-50', textClass: 'text-amber-700 font-semibold', label }
  return { cellClass: '', textClass: 'text-gray-600', label }
}

const EMPTY_FORM = {
  name: '',
  amount: '',
  payment_type: 'monthly' as Payment['payment_type'],
  department_name: '',
  status: 'active' as Payment['status'],
  last_paid_at: '',
  note: '',
  card_holder: '',
  card_last4: '',
}

interface Props {
  profile: Profile
  isSuperAdmin: boolean
  departmentId: string
  departmentName: string
}

export function PaymentsTab({ profile, isSuperAdmin, departmentId, departmentName }: Props) {
  const supabase = createClient()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM, department_name: departmentName })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('department_payments')
      .select('*')
      .eq('department_id', departmentId)
      .order('created_at', { ascending: false })
    setPayments(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, department_name: departmentName })
    setDialogOpen(true)
  }

  function openEdit(p: Payment) {
    setEditId(p.id)
    setForm({
      name: p.name,
      amount: String(p.amount),
      payment_type: p.payment_type,
      department_name: p.department_name,
      status: p.status,
      last_paid_at: p.last_paid_at ?? '',
      note: p.note ?? '',
      card_holder: p.card_holder ?? '',
      card_last4: p.card_last4 ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      name: form.name,
      amount: parseFloat(form.amount) || 0,
      payment_type: form.payment_type,
      department_name: form.department_name,
      department_id: departmentId,
      status: form.status,
      last_paid_at: form.last_paid_at || null,
      note: form.note || null,
      card_holder: form.card_holder || null,
      card_last4: form.card_last4 || null,
      updated_at: new Date().toISOString(),
    }

    if (editId) {
      const { error } = await supabase.from('department_payments').update(payload).eq('id', editId)
      if (error) { toast.error(`فشل التعديل: ${error.message}`); setSaving(false); return }
      toast.success('تم التعديل')
    } else {
      const { error } = await supabase.from('department_payments').insert({ ...payload, created_by: profile.id })
      if (error) { toast.error(`فشلت الإضافة: ${error.message}`); setSaving(false); return }
      toast.success('تمت الإضافة')
    }

    setDialogOpen(false)
    setSaving(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذه المدفوعة؟')) return
    const { error } = await supabase.from('department_payments').delete().eq('id', id)
    if (error) { toast.error('فشل الحذف'); return }
    toast.success('تم الحذف')
    setPayments(prev => prev.filter(p => p.id !== id))
  }

  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">المدفوعات</h2>
          <p className="text-gray-500 text-sm">{payments.length} مدفوعة مسجلة</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            إضافة
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-200" />
          الدفعة خلال أسبوعين
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-200" />
          الدفعة خلال أسبوع
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">جارٍ التحميل...</div>
      ) : payments.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">لا توجد مدفوعات مسجلة لهذا القسم</p>
          {isSuperAdmin && (
            <button onClick={openAdd} className="mt-3 text-sm text-gray-500 underline">إضافة مدفوعة</button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">الاسم</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">المبلغ</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">النوع</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">القسم / الجهة</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">الحالة</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">آخر دفعة</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">الدفعة القادمة</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">صاحب البطاقة</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">آخر 4 أرقام</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">ملاحظة</th>
                  {isSuperAdmin && <th className="px-4 py-3 w-20" />}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const next = calcNextPayment(p.last_paid_at, p.payment_type)
                  const { cellClass, textClass, label: nextLabel } = nextPaymentInfo(next)
                  return (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-3 font-bold text-gray-800 tabular-nums whitespace-nowrap" suppressHydrationWarning>
                        {p.amount.toLocaleString('ar-SA')} ر.س
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {TYPE_LABELS[p.payment_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.department_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                          {STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap" suppressHydrationWarning>
                        {p.last_paid_at
                          ? new Date(p.last_paid_at).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })
                          : '—'}
                      </td>
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${cellClass}`} suppressHydrationWarning>
                        <span className={textClass} suppressHydrationWarning>{nextLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm">{p.card_holder || '—'}</td>
                      <td className="px-4 py-3">
                        {p.card_last4
                          ? <span className="font-mono text-sm tracking-widest text-gray-700">•••• {p.card_last4}</span>
                          : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[150px] truncate">{p.note || '—'}</td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            <button onClick={() => openEdit(p)} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editId ? 'تعديل مدفوعة' : 'إضافة مدفوعة'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>اسم المدفوعة</Label>
                <Input value={form.name} onChange={e => f('name', e.target.value)} placeholder="مثال: إيجار المكتب" required />
              </div>

              <div className="space-y-1.5">
                <Label>المبلغ (ر.س)</Label>
                <Input type="number" min="0" step="0.01" value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0.00" required />
              </div>

              <div className="space-y-1.5">
                <Label>النوع</Label>
                <select value={form.payment_type} onChange={e => f('payment_type', e.target.value)} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background">
                  <option value="monthly">شهري</option>
                  <option value="annual">سنوي</option>
                  <option value="one_time">مرة واحدة</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>القسم / الجهة</Label>
                <Input value={form.department_name} onChange={e => f('department_name', e.target.value)} placeholder="اسم الجهة أو القسم" />
              </div>

              <div className="space-y-1.5">
                <Label>الحالة</Label>
                <select value={form.status} onChange={e => f('status', e.target.value)} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background">
                  <option value="active">شغال</option>
                  <option value="paused">موقف مؤقتاً</option>
                  <option value="due">يستحق الدفع</option>
                </select>
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>آخر دفعة دُفعت</Label>
                <Input type="date" value={form.last_paid_at} onChange={e => f('last_paid_at', e.target.value)} />
                {form.last_paid_at && form.payment_type !== 'one_time' && (
                  <p className="text-xs text-gray-500" suppressHydrationWarning>
                    الدفعة القادمة:{' '}
                    <span className="font-medium text-gray-700" suppressHydrationWarning>
                      {calcNextPayment(form.last_paid_at, form.payment_type)?.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>اسم صاحب البطاقة</Label>
                <Input value={form.card_holder} onChange={e => f('card_holder', e.target.value)} placeholder="مثال: Elzubair Al..." />
              </div>

              <div className="space-y-1.5">
                <Label>آخر 4 أرقام في البطاقة</Label>
                <Input
                  value={form.card_last4}
                  onChange={e => f('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="مثال: 4242"
                  maxLength={4}
                  inputMode="numeric"
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>ملاحظة</Label>
                <Textarea value={form.note} onChange={e => f('note', e.target.value)} placeholder="ملاحظات إضافية..." rows={2} />
              </div>
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />جارٍ الحفظ...</> : editId ? 'حفظ التعديلات' : 'إضافة'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
