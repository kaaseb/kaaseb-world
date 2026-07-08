'use client'

import { useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  format,
  addDays,
  differenceInDays,
  isAfter,
} from 'date-fns'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  Plus,
  Trash2,
  Edit,
  Loader2,
  X,
  Check,
  CreditCard,
  TrendingUp,
  Target,
  BarChart3,
  Sparkles,
  ExternalLink,
  AlertCircle,
  AlertTriangle,
  Calendar,
  DollarSign,
  TrendingDown,
  Lightbulb,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  HelpCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DueType = 'monthly' | 'quarterly' | 'yearly' | 'two_years' | 'one-time' | 'custom' | string
type DueStatus = 'paid' | 'unpaid' | 'overdue'

type DuePriority = 'essential' | 'important' | 'replaceable' | 'not_important'

interface Due {
  id: string
  platform: string
  amount: number
  type: DueType
  interval_days: number | null
  category: string | null
  priority: DuePriority | null
  status: DueStatus
  last_payment_date: string | null
  next_payment_date: string | null
  payment_link: string | null
  notes: string | null
  created_at: string
}

interface Income {
  id: string
  source: string
  amount: number
  type: string
  interval_days: number | null
  created_date: string
  notes: string | null
  how_to_prove: string | null
  how_to_increase: string | null
  created_at: string
}

interface GoalStep {
  id: string
  goal_id: string
  title: string
  completed: boolean
  position: number
}

interface FinGoal {
  id: string
  name: string
  type: string
  target_amount: number
  current_amount: number
  deadline: string | null
  steps: GoalStep[]
}

interface Opportunity {
  id: string
  name: string
  requirements: string | null
  notes: string | null
  created_at: string
}

interface FinancesClientProps {
  initialDues: Due[]
  initialIncome: Income[]
  initialGoals: FinGoal[]
  initialOpportunities: Opportunity[]
  userId: string
}

const SAR = 'ر.س'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcNextPaymentDate(
  type: DueType,
  lastPayment: string | null,
  intervalDays: number | null
): string | null {
  const base = lastPayment ? new Date(lastPayment) : new Date()
  if (type === 'monthly') return format(addDays(base, 30), 'yyyy-MM-dd')
  if (type === 'quarterly') return format(addDays(base, 90), 'yyyy-MM-dd')
  if (type === 'yearly') return format(addDays(base, 365), 'yyyy-MM-dd')
  if (type === 'two_years') return format(addDays(base, 730), 'yyyy-MM-dd')
  if (type === 'one-time') return null
  if (type === 'custom' && intervalDays) return format(addDays(base, intervalDays), 'yyyy-MM-dd')
  if (intervalDays) return format(addDays(base, intervalDays), 'yyyy-MM-dd')
  return null
}

function getDueRowClass(due: Due): string {
  if (!due.next_payment_date) return ''
  const days = differenceInDays(new Date(due.next_payment_date), new Date())
  if (days <= 7) return 'bg-red-50'
  if (days <= 14) return 'bg-amber-50'
  return ''
}

const PIE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

// ─── API Helper ────────────────────────────────────────────────────────────────

async function finApi(table: string, action: string, payload?: unknown, id?: string): Promise<{ data?: unknown; error?: string; success?: boolean }> {
  const res = await fetch('/api/finances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, action, payload, id }),
  })
  return res.json()
}

// ─── Inline Input Styles ───────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 bg-white'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// ─── Dialog Overlay ────────────────────────────────────────────────────────────

function DialogOverlay({
  show,
  onClose,
  title,
  children,
}: {
  show: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!show) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color,
  sub,
}: {
  label: string
  value: string
  icon: React.ReactNode
  color: string
  sub?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', color)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Expandable Type / Category Builder ───────────────────────────────────────

function ExtendableSelect({
  label,
  value,
  onChange,
  options,
  onAddOption,
  addLabel,
  newItemLabel,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  onAddOption: (v: string) => void
  addLabel: string
  newItemLabel: string
}) {
  const [adding, setAdding] = useState(false)
  const [newVal, setNewVal] = useState('')

  function handleAdd() {
    const trimmed = newVal.trim()
    if (!trimmed) return
    onAddOption(trimmed)
    onChange(trimmed)
    setNewVal('')
    setAdding(false)
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={cn(inputCls, 'flex-1')}
        >
          <option value="">—</option>
          {options.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAdding(v => !v)}
          className="px-2.5 py-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
          title={addLabel}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {adding && (
        <div className="flex gap-2 mt-2">
          <input
            className={cn(inputCls, 'flex-1')}
            placeholder={newItemLabel}
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAdd())}
            autoFocus
          />
          <button
            type="button"
            onClick={handleAdd}
            className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Check className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── TAB 1: Dues ──────────────────────────────────────────────────────────────

interface DuesTabProps {
  dues: Due[]
  setDues: React.Dispatch<React.SetStateAction<Due[]>>
}

function DuesTab({ dues, setDues }: DuesTabProps) {
  const { t, isRtl } = useLanguage()

  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [editDue, setEditDue] = useState<Due | null>(null)
  const [loading, setLoading] = useState(false)

  const [dueTypes, setDueTypes] = useState(['monthly', 'quarterly', 'yearly', 'two_years', 'one-time', 'custom'])
  const [dueCategories, setDueCategories] = useState(['servers', 'tools', 'marketing', 'design', 'other'])

  // Form state
  const [fPlatform, setFPlatform] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fType, setFType] = useState('monthly')
  const [fCategory, setFCategory] = useState('')
  const [fStatus, setFStatus] = useState<DueStatus>('unpaid')
  const [fLastPayment, setFLastPayment] = useState('')
  const [fIntervalDays, setFIntervalDays] = useState('')
  const [fPaymentLink, setFPaymentLink] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [fPriority, setFPriority] = useState<DuePriority>('important')

  function resetForm() {
    setFPlatform(''); setFAmount(''); setFType('monthly'); setFCategory('')
    setFStatus('unpaid'); setFLastPayment(''); setFIntervalDays('')
    setFPaymentLink(''); setFNotes(''); setFPriority('important')
  }

  function openEdit(due: Due) {
    setEditDue(due)
    setFPlatform(due.platform)
    setFAmount(String(due.amount))
    setFType(due.type)
    setFCategory(due.category ?? '')
    setFStatus(due.status)
    setFLastPayment(due.last_payment_date ?? '')
    setFIntervalDays(due.interval_days ? String(due.interval_days) : '')
    setFPaymentLink(due.payment_link ?? '')
    setFNotes(due.notes ?? '')
    setFPriority(due.priority ?? 'important')
  }

  function buildPayload() {
    const intervalDays = fType === 'custom' ? (Number(fIntervalDays) || null) : null
    const nextPayment = calcNextPaymentDate(fType, fLastPayment || null, intervalDays)
    return {
      platform: fPlatform.trim(),
      amount: parseFloat(fAmount) || 0,
      type: fType,
      interval_days: intervalDays,
      category: fCategory || null,
      status: fStatus,
      last_payment_date: fLastPayment || null,
      next_payment_date: nextPayment,
      payment_link: fPaymentLink || null,
      notes: fNotes || null,
      priority: fPriority,
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const payload = buildPayload()
    const result = await finApi('finance_dues', 'insert', payload)
    if (result.error) { toast.error('Failed to add due'); setLoading(false); return }
    const data = result.data as Due
    setDues(prev => [data, ...prev])
    setShowAdd(false)
    resetForm()
    toast.success('Due added')
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editDue) return
    setLoading(true)
    const payload = buildPayload()
    const result = await finApi('finance_dues', 'update', payload, editDue.id)
    if (result.error) { toast.error('Failed to update due'); setLoading(false); return }
    const data = result.data as Due
    setDues(prev => prev.map(d => d.id === editDue.id ? data : d))
    setEditDue(null)
    resetForm()
    toast.success('Due updated')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this due?')) return
    const result = await finApi('finance_dues', 'delete', undefined, id)
    if (result.error) { toast.error('Failed to delete'); return }
    setDues(prev => prev.filter(d => d.id !== id))
    toast.success('Due deleted')
  }

  async function handlePay(due: Due) {
    const today = format(new Date(), 'yyyy-MM-dd')
    const intervalDays = due.type === 'custom' ? due.interval_days : null
    const nextPayment = calcNextPaymentDate(due.type, today, intervalDays)
    const payload = {
      status: 'paid' as DueStatus,
      last_payment_date: today,
      next_payment_date: nextPayment,
    }
    const result = await finApi('finance_dues', 'update', payload, due.id)
    if (result.error) { toast.error('Failed to mark as paid'); return }
    const data = result.data as Due
    setDues(prev => prev.map(d => d.id === due.id ? data : d))
    toast.success('Marked as paid')
  }

  const filtered = dues.filter(d => {
    if (filterType && d.type !== filterType) return false
    if (filterCategory && d.category !== filterCategory) return false
    if (filterStatus && d.status !== filterStatus) return false
    return true
  })

  const allCategories = [...new Set([...dueCategories, ...dues.map(d => d.category).filter(Boolean) as string[]])]

  const DueForm = (
    <form onSubmit={editDue ? handleEdit : handleAdd} className="space-y-3">
      <div>
        <label className={labelCls}>{t('fin_platform')}</label>
        <input className={inputCls} value={fPlatform} onChange={e => setFPlatform(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t('fin_amount')}</label>
          <input type="number" step="0.01" className={inputCls} value={fAmount} onChange={e => setFAmount(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>{t('fin_status')}</label>
          <select className={inputCls} value={fStatus} onChange={e => setFStatus(e.target.value as DueStatus)}>
            <option value="paid">{t('fin_paid')}</option>
            <option value="unpaid">{t('fin_unpaid')}</option>
            <option value="overdue">{t('fin_overdue')}</option>
          </select>
        </div>
      </div>
      <ExtendableSelect
        label={t('fin_type')}
        value={fType}
        onChange={setFType}
        options={dueTypes}
        onAddOption={v => setDueTypes(prev => [...prev, v])}
        addLabel={t('fin_add_type')}
        newItemLabel={t('fin_new_type')}
      />
      {fType === 'custom' && (
        <div>
          <label className={labelCls}>{t('fin_interval_days')}</label>
          <input type="number" className={inputCls} value={fIntervalDays} onChange={e => setFIntervalDays(e.target.value)} min="1" />
        </div>
      )}
      <ExtendableSelect
        label={`${t('fin_category')} (${t('optional')})`}
        value={fCategory}
        onChange={setFCategory}
        options={allCategories}
        onAddOption={v => setDueCategories(prev => [...prev, v])}
        addLabel={t('fin_add_category')}
        newItemLabel={t('fin_new_category')}
      />
      <div>
        <label className={labelCls}>{t('fin_priority')}</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'essential', label: t('fin_priority_essential'), color: 'border-red-400 bg-red-50 text-red-700' },
            { value: 'important', label: t('fin_priority_important'), color: 'border-amber-400 bg-amber-50 text-amber-700' },
            { value: 'replaceable', label: t('fin_priority_replaceable'), color: 'border-blue-400 bg-blue-50 text-blue-700' },
            { value: 'not_important', label: t('fin_priority_not_important'), color: 'border-gray-300 bg-gray-50 text-gray-600' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFPriority(opt.value)}
              className={`p-2 rounded-lg border text-xs font-medium transition-colors ${fPriority === opt.value ? opt.color : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={labelCls}>{t('fin_last_payment')} ({t('optional')})</label>
        <input type="date" className={inputCls} value={fLastPayment} onChange={e => setFLastPayment(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_payment_link')} ({t('optional')})</label>
        <input type="url" className={inputCls} value={fPaymentLink} onChange={e => setFPaymentLink(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_notes')} ({t('optional')})</label>
        <textarea className={inputCls} rows={2} value={fNotes} onChange={e => setFNotes(e.target.value)} />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {editDue ? t('save') : t('fin_add_due')}
      </button>
    </form>
  )

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">{t('fin_type')}: {t('fin_all')}</option>
          {dueTypes.map(t_ => <option key={t_} value={t_}>{t_ === 'monthly' ? t('fin_type_monthly') : t_ === 'quarterly' ? t('fin_type_quarterly') : t_ === 'yearly' ? t('fin_type_yearly') : t_ === 'two_years' ? t('fin_type_two_years') : t_ === 'one-time' ? t('fin_type_one_time') : t_ === 'custom' ? t('fin_type_custom') : t_}</option>)}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
        >
          <option value="">{t('fin_category')}: {t('fin_all')}</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">{t('fin_status')}: {t('fin_all')}</option>
          <option value="paid">{t('fin_paid')}</option>
          <option value="unpaid">{t('fin_unpaid')}</option>
          <option value="overdue">{t('fin_overdue')}</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={() => { resetForm(); setShowAdd(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('fin_add_due')}
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <CreditCard className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-sm text-gray-400">{t('fin_no_dues')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_platform')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_amount')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_type')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_category')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_priority')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_status')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_last_payment')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_next_payment')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(due => {
                  const effectiveNextPayment = due.next_payment_date
                    ?? calcNextPaymentDate(due.type, due.last_payment_date ?? due.created_at, due.interval_days)
                  const rowCls = getDueRowClass({ ...due, next_payment_date: effectiveNextPayment })
                  const daysUntil = effectiveNextPayment
                    ? differenceInDays(new Date(effectiveNextPayment), new Date())
                    : null
                  return (
                    <tr key={due.id} className={cn('transition-colors hover:bg-gray-50', rowCls)}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-1.5">
                          {due.platform}
                          {due.payment_link && (
                            <a href={due.payment_link} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500 transition-colors">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        {due.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-32">{due.notes}</p>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{SAR} {due.amount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          {due.type === 'monthly' ? t('fin_type_monthly') : due.type === 'quarterly' ? t('fin_type_quarterly') : due.type === 'yearly' ? t('fin_type_yearly') : due.type === 'two_years' ? t('fin_type_two_years') : due.type === 'one-time' ? t('fin_type_one_time') : due.type === 'custom' ? t('fin_type_custom') : due.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{due.category || '—'}</td>
                      <td className="px-4 py-3">
                        {due.priority ? (
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                            due.priority === 'essential' && 'bg-red-50 text-red-700',
                            due.priority === 'important' && 'bg-amber-50 text-amber-700',
                            due.priority === 'replaceable' && 'bg-blue-50 text-blue-700',
                            due.priority === 'not_important' && 'bg-gray-100 text-gray-600',
                          )}>
                            {t(`fin_priority_${due.priority}`)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          due.status === 'paid' && 'bg-green-50 text-green-700',
                          due.status === 'unpaid' && 'bg-amber-50 text-amber-700',
                          due.status === 'overdue' && 'bg-red-50 text-red-700',
                        )}>
                          {t(due.status === 'paid' ? 'fin_paid' : due.status === 'unpaid' ? 'fin_unpaid' : 'fin_overdue')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {due.last_payment_date ? format(new Date(due.last_payment_date), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {effectiveNextPayment ? (
                          <div>
                            <p className={cn(
                              'font-medium',
                              daysUntil !== null && daysUntil <= 7 && 'text-red-600',
                              daysUntil !== null && daysUntil > 7 && daysUntil <= 14 && 'text-amber-600',
                              daysUntil !== null && daysUntil > 14 && 'text-gray-700',
                            )}>
                              {format(new Date(effectiveNextPayment), 'MMM d, yyyy')}
                            </p>
                            {daysUntil !== null && (
                              <p className="text-gray-400 mt-0.5">
                                {daysUntil < 0
                                  ? `${t('fin_overdue_by')} ${Math.abs(daysUntil)} ${t('fin_days')}`
                                  : `${t('fin_due_in')} ${daysUntil} ${t('fin_days')}`}
                              </p>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {due.status !== 'paid' && (
                            <button
                              onClick={() => handlePay(due)}
                              className="px-2.5 py-1 bg-green-50 text-green-700 hover:bg-green-100 text-xs font-medium rounded-lg transition-colors"
                            >
                              {t('fin_pay')}
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(due)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(due.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Dialog */}
      <DialogOverlay show={showAdd} onClose={() => { setShowAdd(false); resetForm() }} title={t('fin_add_due')}>
        {DueForm}
      </DialogOverlay>

      {/* Edit Dialog */}
      <DialogOverlay show={!!editDue} onClose={() => { setEditDue(null); resetForm() }} title={t('edit')}>
        {DueForm}
      </DialogOverlay>
    </div>
  )
}

// ─── TAB 2: Income ────────────────────────────────────────────────────────────

interface IncomeTabProps {
  income: Income[]
  setIncome: React.Dispatch<React.SetStateAction<Income[]>>
}

function IncomeTab({ income, setIncome }: IncomeTabProps) {
  const { t, isRtl } = useLanguage()

  const [showAdd, setShowAdd] = useState(false)
  const [editItem, setEditItem] = useState<Income | null>(null)
  const [loading, setLoading] = useState(false)

  const [incomeTypes, setIncomeTypes] = useState(['monthly', 'yearly', 'fixed', 'custom'])

  const [fSource, setFSource] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fType, setFType] = useState('monthly')
  const [fIntervalDays, setFIntervalDays] = useState('')
  const [fCreatedDate, setFCreatedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [fNotes, setFNotes] = useState('')
  const [fHowToProve, setFHowToProve] = useState('')
  const [fHowToIncrease, setFHowToIncrease] = useState('')

  function resetForm() {
    setFSource(''); setFAmount(''); setFType('monthly')
    setFIntervalDays(''); setFCreatedDate(format(new Date(), 'yyyy-MM-dd')); setFNotes('')
    setFHowToProve(''); setFHowToIncrease('')
  }

  function openEdit(item: Income) {
    setEditItem(item)
    setFSource(item.source)
    setFAmount(String(item.amount))
    setFType(item.type)
    setFIntervalDays(item.interval_days ? String(item.interval_days) : '')
    setFCreatedDate(item.created_date)
    setFNotes(item.notes ?? '')
    setFHowToProve(item.how_to_prove ?? '')
    setFHowToIncrease(item.how_to_increase ?? '')
  }

  function buildPayload() {
    return {
      source: fSource.trim(),
      amount: parseFloat(fAmount) || 0,
      type: fType,
      interval_days: fType === 'custom' ? (Number(fIntervalDays) || null) : null,
      created_date: fCreatedDate,
      notes: fNotes || null,
      how_to_prove: fHowToProve || null,
      how_to_increase: fHowToIncrease || null,
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const payload = buildPayload()
    const result = await finApi('finance_income', 'insert', payload)
    if (result.error) { toast.error('Failed to add income'); setLoading(false); return }
    const data = result.data as Income
    setIncome(prev => [data, ...prev])
    setShowAdd(false)
    resetForm()
    toast.success('Income added')
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editItem) return
    setLoading(true)
    const payload = buildPayload()
    const result = await finApi('finance_income', 'update', payload, editItem.id)
    if (result.error) { toast.error('Failed to update income'); setLoading(false); return }
    const data = result.data as Income
    setIncome(prev => prev.map(i => i.id === editItem.id ? data : i))
    setEditItem(null)
    resetForm()
    toast.success('Income updated')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this income?')) return
    const result = await finApi('finance_income', 'delete', undefined, id)
    if (result.error) { toast.error('Failed to delete'); return }
    setIncome(prev => prev.filter(i => i.id !== id))
    toast.success('Income deleted')
  }

  // Stat calculations
  const monthlyIncome = income.reduce((sum, i) => {
    if (i.type === 'monthly') return sum + i.amount
    if (i.type === 'yearly') return sum + i.amount / 12
    return sum
  }, 0)

  const yearlyIncome = income.reduce((sum, i) => {
    if (i.type === 'monthly') return sum + i.amount * 12
    if (i.type === 'yearly') return sum + i.amount
    if (i.type === 'fixed') return sum + i.amount
    return sum
  }, 0)

  const IncomeForm = (
    <form onSubmit={editItem ? handleEdit : handleAdd} className="space-y-3">
      <div>
        <label className={labelCls}>{t('fin_source')}</label>
        <input className={inputCls} value={fSource} onChange={e => setFSource(e.target.value)} required />
      </div>
      <div>
        <label className={labelCls}>{t('fin_amount')}</label>
        <input type="number" step="0.01" className={inputCls} value={fAmount} onChange={e => setFAmount(e.target.value)} required />
      </div>
      <ExtendableSelect
        label={t('fin_type')}
        value={fType}
        onChange={setFType}
        options={incomeTypes}
        onAddOption={v => setIncomeTypes(prev => [...prev, v])}
        addLabel={t('fin_add_type')}
        newItemLabel={t('fin_new_type')}
      />
      {fType === 'custom' && (
        <div>
          <label className={labelCls}>{t('fin_interval_days')}</label>
          <input type="number" className={inputCls} value={fIntervalDays} onChange={e => setFIntervalDays(e.target.value)} min="1" />
        </div>
      )}
      <div>
        <label className={labelCls}>{t('fin_created_date')}</label>
        <input type="date" className={inputCls} value={fCreatedDate} onChange={e => setFCreatedDate(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_how_to_prove')}</label>
        <textarea className={inputCls} rows={2} value={fHowToProve} onChange={e => setFHowToProve(e.target.value)} placeholder={t('fin_how_to_prove_ph')} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_how_to_increase')}</label>
        <textarea className={inputCls} rows={2} value={fHowToIncrease} onChange={e => setFHowToIncrease(e.target.value)} placeholder={t('fin_how_to_increase_ph')} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_notes')} ({t('optional')})</label>
        <textarea className={inputCls} rows={2} value={fNotes} onChange={e => setFNotes(e.target.value)} />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {editItem ? t('save') : t('fin_add_income')}
      </button>
    </form>
  )

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard
          label={t('fin_monthly_income')}
          value={`${SAR} ${monthlyIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          color="bg-emerald-50"
        />
        <StatCard
          label={t('fin_yearly_income')}
          value={`${SAR} ${yearlyIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon={<DollarSign className="w-5 h-5 text-blue-600" />}
          color="bg-blue-50"
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-end mb-5">
        <button
          onClick={() => { resetForm(); setShowAdd(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('fin_add_income')}
        </button>
      </div>

      {/* Table */}
      {income.length === 0 ? (
        <div className="text-center py-20">
          <TrendingUp className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-sm text-gray-400">{t('fin_no_income')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_source')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_amount')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_type')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_created_date')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_how_to_prove')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_how_to_increase')}</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fin_notes')}</th>
                  <th className="text-left px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {income.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.source}</td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">{SAR} {item.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 capitalize">
                        {item.type === 'monthly' ? t('fin_type_monthly') : item.type === 'yearly' ? t('fin_type_yearly') : item.type === 'fixed' ? t('fin_type_fixed') : item.type === 'custom' ? t('fin_type_custom') : item.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {format(new Date(item.created_date), 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-40 truncate">{item.how_to_prove || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-40 truncate">{item.how_to_increase || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-40 truncate">{item.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DialogOverlay show={showAdd} onClose={() => { setShowAdd(false); resetForm() }} title={t('fin_add_income')}>
        {IncomeForm}
      </DialogOverlay>
      <DialogOverlay show={!!editItem} onClose={() => { setEditItem(null); resetForm() }} title={t('edit')}>
        {IncomeForm}
      </DialogOverlay>
    </div>
  )
}

// ─── TAB 3: Goals ─────────────────────────────────────────────────────────────

interface GoalsTabProps {
  goals: FinGoal[]
  setGoals: React.Dispatch<React.SetStateAction<FinGoal[]>>
}

function GoalCard({
  goal,
  onDelete,
  onToggleStep,
  onEdit,
}: {
  goal: FinGoal
  onDelete: (id: string) => void
  onToggleStep: (goalId: string, stepId: string, completed: boolean) => void
  onEdit: (goal: FinGoal) => void
}) {
  const { t } = useLanguage()

  const stepProgress = goal.steps.length > 0
    ? Math.round((goal.steps.filter(s => s.completed).length / goal.steps.length) * 100)
    : 0
  const amountProgress = goal.target_amount > 0
    ? Math.round((goal.current_amount / goal.target_amount) * 100)
    : 0
  const progress = Math.min(100, Math.max(stepProgress, amountProgress))

  const daysLeft = goal.deadline
    ? differenceInDays(new Date(goal.deadline), new Date())
    : null

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{goal.name}</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 mt-1 capitalize">
            {goal.type === 'savings' ? t('fin_goal_savings') : goal.type === 'investment' ? t('fin_goal_investment') : goal.type === 'revenue' ? t('fin_goal_revenue') : goal.type === 'expense-reduction' ? t('fin_goal_expense_red') : goal.type === 'other' ? t('fin_goal_other') : goal.type}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onEdit(goal)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(goal.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Amount */}
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-gray-500">{t('fin_current')}: <span className="font-semibold text-gray-900">{SAR} {goal.current_amount.toLocaleString()}</span></span>
        <span className="text-gray-500">{t('fin_target')}: <span className="font-semibold text-gray-900">{SAR} {goal.target_amount.toLocaleString()}</span></span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">{t('fin_progress')}</span>
        <span className="text-xs font-bold text-gray-700">{progress}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background: progress >= 100 ? '#22c55e' : '#6366f1',
          }}
        />
      </div>

      {/* Deadline */}
      {goal.deadline && (
        <div className={cn(
          'flex items-center gap-1.5 text-xs mb-3 font-medium',
          daysLeft !== null && daysLeft < 0 && 'text-red-600',
          daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && 'text-amber-600',
          daysLeft !== null && daysLeft > 30 && 'text-gray-500',
        )}>
          <Calendar className="w-3 h-3" />
          {daysLeft !== null && daysLeft < 0
            ? `${t('fin_overdue_by')} ${Math.abs(daysLeft)} ${t('fin_days')}`
            : `${daysLeft} ${t('fin_days_remaining')}`}
        </div>
      )}

      {/* Steps */}
      {goal.steps.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-50 pt-3">
          <p className="text-xs font-medium text-gray-500 mb-2">{t('fin_steps')}</p>
          {goal.steps.sort((a, b) => a.position - b.position).map(step => (
            <button
              key={step.id}
              onClick={() => onToggleStep(goal.id, step.id, step.completed)}
              className="w-full flex items-center gap-2 text-left group"
            >
              <div className={cn(
                'w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all',
                step.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 group-hover:border-green-400',
              )}>
                {step.completed && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <span className={cn('text-xs', step.completed ? 'line-through text-gray-400' : 'text-gray-700')}>{step.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GoalsTab({ goals, setGoals }: GoalsTabProps) {
  const { t, isRtl } = useLanguage()

  const [showAdd, setShowAdd] = useState(false)
  const [editGoal, setEditGoal] = useState<FinGoal | null>(null)
  const [loading, setLoading] = useState(false)

  const [fName, setFName] = useState('')
  const [fType, setFType] = useState('savings')
  const [fTarget, setFTarget] = useState('')
  const [fCurrent, setFCurrent] = useState('')
  const [fDeadline, setFDeadline] = useState('')
  const [fSteps, setFSteps] = useState([''])

  const goalTypes = ['savings', 'investment', 'revenue', 'expense-reduction', 'other']

  function resetForm() {
    setFName(''); setFType('savings'); setFTarget('')
    setFCurrent(''); setFDeadline(''); setFSteps([''])
  }

  function openEdit(goal: FinGoal) {
    setEditGoal(goal)
    setFName(goal.name)
    setFType(goal.type)
    setFTarget(String(goal.target_amount))
    setFCurrent(String(goal.current_amount))
    setFDeadline(goal.deadline ?? '')
    setFSteps(goal.steps.length > 0 ? goal.steps.sort((a, b) => a.position - b.position).map(s => s.title) : [''])
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const goalPayload = {
      name: fName.trim(),
      type: fType,
      target_amount: parseFloat(fTarget) || 0,
      current_amount: parseFloat(fCurrent) || 0,
      deadline: fDeadline || null,
    }
    const goalResult = await finApi('finance_goals', 'insert', goalPayload)
    if (goalResult.error) { toast.error('Failed to create goal'); setLoading(false); return }
    const goalData = goalResult.data as FinGoal

    let steps: GoalStep[] = []
    const validSteps = fSteps.filter(s => s.trim())
    if (validSteps.length > 0) {
      const stepsPayload = validSteps.map((s, i) => ({ goal_id: goalData.id, title: s, position: i, completed: false }))
      const stepsResult = await finApi('finance_goal_steps', 'insert_many', stepsPayload)
      if (stepsResult.data) steps = stepsResult.data as GoalStep[]
    }

    setGoals(prev => [{ ...goalData, steps }, ...prev])
    setShowAdd(false)
    resetForm()
    toast.success('Goal created')
    setLoading(false)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editGoal) return
    setLoading(true)
    const goalPayload = {
      name: fName.trim(),
      type: fType,
      target_amount: parseFloat(fTarget) || 0,
      current_amount: parseFloat(fCurrent) || 0,
      deadline: fDeadline || null,
    }
    const result = await finApi('finance_goals', 'update', goalPayload, editGoal.id)
    if (result.error) { toast.error('Failed to update goal'); setLoading(false); return }
    const goalData = result.data as FinGoal

    // Re-sync steps
    await finApi('finance_goal_steps', 'delete_where', { field: 'goal_id', value: editGoal.id })
    let steps: GoalStep[] = []
    const validSteps = fSteps.filter(s => s.trim())
    if (validSteps.length > 0) {
      const stepsPayload = validSteps.map((s, i) => ({ goal_id: editGoal.id, title: s, position: i, completed: false }))
      const stepsResult = await finApi('finance_goal_steps', 'insert_many', stepsPayload)
      if (stepsResult.data) steps = stepsResult.data as GoalStep[]
    }

    setGoals(prev => prev.map(g => g.id === editGoal.id ? { ...goalData, steps } : g))
    setEditGoal(null)
    resetForm()
    toast.success('Goal updated')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this goal?')) return
    await finApi('finance_goals', 'delete', undefined, id)
    setGoals(prev => prev.filter(g => g.id !== id))
    toast.success('Goal deleted')
  }

  async function handleToggleStep(goalId: string, stepId: string, completed: boolean) {
    await finApi('finance_goal_steps', 'update', { completed: !completed }, stepId)
    setGoals(prev => prev.map(g =>
      g.id === goalId
        ? { ...g, steps: g.steps.map(s => s.id === stepId ? { ...s, completed: !completed } : s) }
        : g
    ))
  }

  const GoalForm = (
    <form onSubmit={editGoal ? handleEdit : handleAdd} className="space-y-3">
      <div>
        <label className={labelCls}>{t('fin_goal_name')}</label>
        <input className={inputCls} value={fName} onChange={e => setFName(e.target.value)} required />
      </div>
      <div>
        <label className={labelCls}>{t('fin_type')}</label>
        <select className={inputCls} value={fType} onChange={e => setFType(e.target.value)}>
          {goalTypes.map(gt => <option key={gt} value={gt}>{gt === 'savings' ? t('fin_goal_savings') : gt === 'investment' ? t('fin_goal_investment') : gt === 'revenue' ? t('fin_goal_revenue') : gt === 'expense-reduction' ? t('fin_goal_expense_red') : gt === 'other' ? t('fin_goal_other') : gt}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t('fin_target')}</label>
          <input type="number" step="0.01" className={inputCls} value={fTarget} onChange={e => setFTarget(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>{t('fin_current')}</label>
          <input type="number" step="0.01" className={inputCls} value={fCurrent} onChange={e => setFCurrent(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelCls}>{t('fin_deadline')} ({t('optional')})</label>
        <input type="date" className={inputCls} value={fDeadline} onChange={e => setFDeadline(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>{t('fin_steps')} ({t('optional')})</label>
        <div className="space-y-2">
          {fSteps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={cn(inputCls, 'flex-1')}
                value={s}
                placeholder={`${t('goal_step_ph')} ${i + 1}`}
                onChange={e => setFSteps(fSteps.map((v, j) => j === i ? e.target.value : v))}
              />
              {fSteps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setFSteps(fSteps.filter((_, j) => j !== i))}
                  className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setFSteps([...fSteps, ''])}
            className="text-sm text-blue-600 hover:underline"
          >
            + {t('fin_add_step')}
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {editGoal ? t('save') : t('fin_add_goal')}
      </button>
    </form>
  )

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-end mb-5">
        <button
          onClick={() => { resetForm(); setShowAdd(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('fin_add_goal')}
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="text-center py-20">
          <Target className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-sm text-gray-400">{t('fin_no_goals')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {goals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onDelete={handleDelete}
              onToggleStep={handleToggleStep}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <DialogOverlay show={showAdd} onClose={() => { setShowAdd(false); resetForm() }} title={t('fin_add_goal')}>
        {GoalForm}
      </DialogOverlay>
      <DialogOverlay show={!!editGoal} onClose={() => { setEditGoal(null); resetForm() }} title={t('edit')}>
        {GoalForm}
      </DialogOverlay>
    </div>
  )
}

// ─── TAB 4: Statistics ────────────────────────────────────────────────────────

interface StatsTabProps {
  dues: Due[]
  income: Income[]
}

function StatsTab({ dues, income }: StatsTabProps) {
  const { t, isRtl } = useLanguage()

  // Monthly expenses = dues that are monthly or (yearly/12) etc.
  const monthlyExpenses = dues.reduce((sum, d) => {
    if (d.type === 'monthly') return sum + d.amount
    if (d.type === 'yearly') return sum + d.amount / 12
    if (d.type === 'one-time') return sum
    if (d.interval_days) return sum + (d.amount / d.interval_days) * 30
    return sum
  }, 0)

  const monthlyIncome = income.reduce((sum, i) => {
    if (i.type === 'monthly') return sum + i.amount
    if (i.type === 'yearly') return sum + i.amount / 12
    if (i.type === 'custom' && i.interval_days) return sum + (i.amount / i.interval_days) * 30
    return sum
  }, 0)

  const netProfit = monthlyIncome - monthlyExpenses

  const topIncomeSource = income.reduce<Income | null>((top, i) => (!top || i.amount > top.amount ? i : top), null)

  // Category totals
  const categoryTotals: Record<string, number> = {}
  dues.forEach(d => {
    const cat = d.category || 'other'
    const monthly = d.type === 'monthly' ? d.amount
      : d.type === 'yearly' ? d.amount / 12
      : d.interval_days ? (d.amount / d.interval_days) * 30
      : 0
    categoryTotals[cat] = (categoryTotals[cat] || 0) + monthly
  })
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]

  const hasData = dues.length > 0 || income.length > 0

  // Build 6-month chart data (current month real, previous 5 dummy with slight variation)
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const label = format(d, 'MMM yy')
    if (i === 0) {
      months.push({ month: label, income: Math.round(monthlyIncome), expenses: Math.round(monthlyExpenses) })
    } else {
      const factor = 0.75 + Math.random() * 0.4
      months.push({
        month: label,
        income: Math.round(monthlyIncome * factor),
        expenses: Math.round(monthlyExpenses * (0.8 + Math.random() * 0.35)),
      })
    }
  }

  // Pie data
  const pieData = Object.entries(categoryTotals).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Math.round(value),
  }))

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      {!hasData ? (
        <div className="text-center py-20">
          <BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-sm text-gray-400">{t('fin_no_data_stats')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              label={t('fin_total_expenses')}
              value={`${SAR} ${Math.round(monthlyExpenses).toLocaleString()}`}
              icon={<TrendingDown className="w-5 h-5 text-red-500" />}
              color="bg-red-50"
              sub={t('fin_per_month')}
            />
            <StatCard
              label={t('fin_total_income')}
              value={`${SAR} ${Math.round(monthlyIncome).toLocaleString()}`}
              icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
              color="bg-emerald-50"
              sub={t('fin_per_month')}
            />
            <StatCard
              label={t('fin_net_profit')}
              value={`${SAR} ${Math.round(Math.abs(netProfit)).toLocaleString()}`}
              icon={netProfit >= 0
                ? <ArrowUpRight className="w-5 h-5 text-blue-600" />
                : <ArrowDownRight className="w-5 h-5 text-red-500" />}
              color={netProfit >= 0 ? 'bg-blue-50' : 'bg-red-50'}
              sub={netProfit >= 0 ? t('fin_profit') : t('fin_loss')}
            />
            <StatCard
              label={t('fin_top_source')}
              value={topIncomeSource ? topIncomeSource.source : '—'}
              icon={<DollarSign className="w-5 h-5 text-violet-600" />}
              color="bg-violet-50"
              sub={topIncomeSource ? `${SAR} ${topIncomeSource.amount.toLocaleString()}` : undefined}
            />
            <StatCard
              label={t('fin_top_category')}
              value={topCategory ? topCategory[0] : '—'}
              icon={<BarChart3 className="w-5 h-5 text-amber-600" />}
              color="bg-amber-50"
              sub={topCategory ? `${SAR} ${Math.round(topCategory[1]).toLocaleString()}/mo` : undefined}
            />
          </div>

          {/* Line Chart */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-5">{t('fin_income_vs_expenses')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={months} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${SAR} ${v}`} />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                  formatter={(val: unknown) => [`${SAR} ${Number(val).toLocaleString()}`, '']}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="income" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Income" />
                <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Expenses" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart */}
          {pieData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-5">{t('fin_expense_distribution')}</h3>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                      formatter={(val: unknown) => [`${SAR} ${Number(val).toLocaleString()}`, '']}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── TAB 5: AI Insights ───────────────────────────────────────────────────────

interface AIInsight {
  type: 'patterns' | 'opportunities' | 'predictions' | 'recommendations' | 'alerts' | 'income_growth' | 'expense_reduction'
  title: string
  items: string[]
  icon: React.ReactNode
  color: string
}

interface AITabProps {
  dues: Due[]
  income: Income[]
  goals: FinGoal[]
}

function AITab({ dues, income, goals }: AITabProps) {
  const { t, isRtl } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<AIInsight[] | null>(null)

  function generateInsights() {
    setLoading(true)

    setTimeout(() => {
      const results: AIInsight[] = []

      // Monthly figures
      const monthlyExpenses = dues.reduce((sum, d) => {
        if (d.type === 'monthly') return sum + d.amount
        if (d.type === 'yearly') return sum + d.amount / 12
        if (d.interval_days) return sum + (d.amount / d.interval_days) * 30
        return sum
      }, 0)

      const monthlyIncome = income.reduce((sum, i) => {
        if (i.type === 'monthly') return sum + i.amount
        if (i.type === 'yearly') return sum + i.amount / 12
        if (i.type === 'custom' && i.interval_days) return sum + (i.amount / i.interval_days) * 30
        return sum
      }, 0)

      const totalExpenses = monthlyExpenses

      // 1. Spending Patterns
      const categoryTotals: Record<string, number> = {}
      dues.forEach(d => {
        const cat = d.category || 'uncategorized'
        const monthly = d.type === 'monthly' ? d.amount
          : d.type === 'yearly' ? d.amount / 12
          : d.interval_days ? (d.amount / d.interval_days) * 30
          : 0
        categoryTotals[cat] = (categoryTotals[cat] || 0) + monthly
      })

      const patternItems: string[] = []
      if (totalExpenses > 0) {
        Object.entries(categoryTotals)
          .sort((a, b) => b[1] - a[1])
          .forEach(([cat, amt]) => {
            const pct = Math.round((amt / totalExpenses) * 100)
            patternItems.push(`${cat}: ${pct}% من المصروفات (${SAR} ${Math.round(amt).toLocaleString()}/شهر)`)
          })
      }
      if (patternItems.length === 0) patternItems.push('لا توجد بيانات مصروفات للتحليل بعد.')

      results.push({
        type: 'patterns',
        title: t('fin_ai_patterns'),
        items: patternItems,
        icon: <BarChart3 className="w-4 h-4 text-blue-600" />,
        color: 'bg-blue-50 border-blue-100',
      })

      // 2. Alerts (overdue / upcoming)
      const alertItems: string[] = []
      const today = new Date()
      dues.forEach(d => {
        if (d.status === 'overdue') {
          alertItems.push(`${d.platform} متأخر السداد — ${SAR} ${d.amount.toLocaleString()}`)
        } else if (d.next_payment_date) {
          const days = differenceInDays(new Date(d.next_payment_date), today)
          if (days >= 0 && days <= 7) {
            alertItems.push(`${d.platform} يستحق خلال ${days} أيام — ${SAR} ${d.amount.toLocaleString()}`)
          }
        }
      })
      if (alertItems.length === 0) alertItems.push('لا توجد مدفوعات متأخرة أو عاجلة. أنت على المسار الصحيح!')

      results.push({
        type: 'alerts',
        title: t('fin_ai_predictions'),
        items: alertItems,
        icon: <ShieldAlert className="w-4 h-4 text-amber-600" />,
        color: 'bg-amber-50 border-amber-100',
      })

      // 3. Saving Opportunities
      const oppItems: string[] = []
      if (monthlyIncome > 0) {
        const expensePct = (monthlyExpenses / monthlyIncome) * 100
        if (expensePct > 70) {
          oppItems.push(`المصروفات تمثل ${Math.round(expensePct)}% من الدخل — يُنصح بتخفيضها إلى أقل من 70%.`)
        } else {
          oppItems.push(`المصروفات تمثل ${Math.round(expensePct)}% من الدخل — نسبة صحية. استمر على هذا المستوى!`)
        }
        const surplus = monthlyIncome - monthlyExpenses
        if (surplus > 0) {
          oppItems.push(`لديك ${SAR} ${Math.round(surplus).toLocaleString()}/شهر متاحة للادخار أو الاستثمار.`)
        }
      }
      const yearlyDuesCount = dues.filter(d => d.type === 'yearly').length
      if (yearlyDuesCount > 0) {
        oppItems.push(`لديك ${yearlyDuesCount} اشتراك(ات) سنوية — تحقق من ضرورة كل منها.`)
      }
      if (oppItems.length === 0) oppItems.push('أضف بيانات الدخل والمصروفات لاكتشاف فرص التوفير.')

      results.push({
        type: 'opportunities',
        title: t('fin_ai_opportunities'),
        items: oppItems,
        icon: <Lightbulb className="w-4 h-4 text-emerald-600" />,
        color: 'bg-emerald-50 border-emerald-100',
      })

      // 4. Goal Predictions
      const goalItems: string[] = []
      goals.forEach(g => {
        const remaining = g.target_amount - g.current_amount
        if (remaining <= 0) {
          goalItems.push(`"${g.name}": تم بلوغ الهدف! 🎉`)
        } else if (g.deadline && monthlyIncome > monthlyExpenses) {
          const surplus = monthlyIncome - monthlyExpenses
          const monthsNeeded = Math.ceil(remaining / surplus)
          const daysLeft = differenceInDays(new Date(g.deadline), today)
          const monthsLeft = Math.ceil(daysLeft / 30)
          if (monthsNeeded <= monthsLeft) {
            goalItems.push(`"${g.name}": على المسار الصحيح — ستصل للهدف قبل الموعد بـ ${monthsLeft - monthsNeeded} أشهر.`)
          } else {
            goalItems.push(`"${g.name}": بالمعدل الحالي ستصل للهدف خلال ${monthsNeeded} شهر (الموعد بعد ${monthsLeft} شهر).`)
          }
        } else {
          const stepProgress = g.steps.length > 0
            ? Math.round((g.steps.filter(s => s.completed).length / g.steps.length) * 100)
            : 0
          goalItems.push(`"${g.name}": ${stepProgress}% مكتمل — متبقي ${SAR} ${remaining.toLocaleString()}.`)
        }
      })
      if (goalItems.length === 0) goalItems.push('لم تُضف أهدافاً مالية بعد. أضف أهدافاً لمتابعة تقدمك.')

      results.push({
        type: 'predictions',
        title: t('fin_ai_predictions'),
        items: goalItems,
        icon: <Target className="w-4 h-4 text-violet-600" />,
        color: 'bg-violet-50 border-violet-100',
      })

      // 5. Recommendations
      const recItems: string[] = []
      if (monthlyIncome === 0) recItems.push('أضف مصادر دخلك للحصول على توصيات مخصصة.')
      else {
        const savingsRate = ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100
        if (savingsRate < 20) recItems.push('استهدف معدل ادخار 20% لتحقيق الصحة المالية على المدى البعيد.')
        if (savingsRate >= 20) recItems.push('معدل ادخار ممتاز! فكر في استثمار الفائض.')
        if (dues.some(d => d.status === 'overdue')) recItems.push('سدّد الاشتراكات المتأخرة لتجنب انقطاع الخدمة.')
        if (goals.length === 0) recItems.push('ضع هدفاً مالياً ليبقيك متحفزاً ومركزاً.')
        if (dues.filter(d => d.type === 'yearly').length > 3) recItems.push('لديك اشتراكات سنوية كثيرة. راجعها سنوياً.')
        const topCatEntry = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]
        if (topCatEntry && totalExpenses > 0) {
          const pct = (topCatEntry[1] / totalExpenses) * 100
          if (pct > 50) recItems.push(`${topCatEntry[0]} وحده يمثل ${Math.round(pct)}% من المصروفات — ابحث عن بدائل.`)
        }
      }
      if (recItems.length < 2) recItems.push('حافظ على تحديث سجلات مصروفاتك للحصول على رؤى أفضل.')
      recItems.push('راجع لوحة التحكم المالية شهرياً للبقاء على المسار الصحيح.')

      results.push({
        type: 'recommendations',
        title: t('fin_ai_recommendations'),
        items: recItems.slice(0, 5),
        icon: <Sparkles className="w-4 h-4 text-pink-600" />,
        color: 'bg-pink-50 border-pink-100',
      })

      // 6. كيف تزيد مصادر دخلك
      const incomeGrowthItems: string[] = [
        'حدّد مهاراتك التقنية الأقوى (برمجة، تصميم، بنية تحتية) وابدأ بتقديم خدمات فريلانس عليها مباشرة.',
        'أنشئ حساباً على Upwork أو Toptal وضع معدل ساعة يعكس خبرتك — حتى 5 ساعات أسبوعياً تُفرق.',
        'حوّل مشروعاً داخلياً أو أداة تقنية بنيتها إلى منتج SaaS بسيط أو إضافة مدفوعة.',
        'قدّم استشارات تقنية (Technical Advisory) للشركات الناشئة — ساعتان شهرياً بعقد ثابت.',
        'أنشئ محتوى تقنياً (مقالات أو دورة قصيرة) على منصة كـ Gumroad أو Udemy واجعله مصدر دخل سلبي.',
        `دخلك الشهري الحالي: ${SAR} ${monthlyIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })} — استهدف زيادة 20% خلال 6 أشهر من مصدر إضافي واحد.`,
        'شارك في برامج Bug Bounty أو مسابقات تقنية — مردودها مباشر وبدون التزام طويل الأمد.',
        'وسّع شبكتك المهنية على LinkedIn بمحتوى تقني أسبوعي — الفرص تأتي من الظهور.',
      ]
      results.push({
        type: 'income_growth',
        title: 'كيف تزيد مصادر دخلك؟',
        items: incomeGrowthItems,
        icon: <TrendingUp className="w-4 h-4 text-teal-600" />,
        color: 'bg-teal-50 border-teal-100',
      })

      // 7. كيف تقلل مصاريفك
      const expenseRedItems: string[] = []
      // Monthly
      const monthlyDues = dues.filter(d => d.type === 'monthly')
      const yearlyDues = dues.filter(d => d.type === 'yearly')
      const topMonthly = [...monthlyDues].sort((a, b) => b.amount - a.amount).slice(0, 3)
      if (topMonthly.length > 0) {
        expenseRedItems.push(`أكبر 3 التزامات شهرية: ${topMonthly.map(d => `${d.platform} (${SAR} ${d.amount.toLocaleString()})`).join(' • ')} — راجعها أولاً.`)
      }
      if (yearlyDues.length > 0) {
        const yearlyTotal = yearlyDues.reduce((s, d) => s + d.amount, 0)
        expenseRedItems.push(`لديك ${yearlyDues.length} التزام سنوي بإجمالي ${SAR} ${yearlyTotal.toLocaleString()} — قيّم كل واحد: هل تستخدمه فعلاً؟`)
      }
      expenseRedItems.push('فعّل الدفع السنوي بدلاً من الشهري للاشتراكات التي تستخدمها يومياً — توفير يصل 20%.')
      expenseRedItems.push('راجع اشتراكاتك كل 3 أشهر وألغِ كل ما لم تستخدمه خلالها.')
      if (monthlyExpenses > 0) {
        expenseRedItems.push(`مصروفاتك الشهرية ${SAR} ${monthlyExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })} — حدّد هدفاً لتخفيضها 10% (${SAR} ${Math.round(monthlyExpenses * 0.1).toLocaleString()}/شهر).`)
      }
      expenseRedItems.push('للمصروفات اليومية: ضع سقفاً يومياً ثابتاً وتتبعه بتطبيق بسيط.')
      expenseRedItems.push('للمصروفات الكبيرة السنوية: خصص مبلغاً شهرياً صغيراً لها مسبقاً بدلاً من الدفع دفعة واحدة.')
      results.push({
        type: 'expense_reduction',
        title: 'كيف تقلل مصاريفك؟',
        items: expenseRedItems,
        icon: <TrendingDown className="w-4 h-4 text-orange-600" />,
        color: 'bg-orange-50 border-orange-100',
      })

      setInsights(results)
      setLoading(false)
    }, 1500)
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="max-w-3xl">
      {!insights && !loading && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gradient-to-br from-violet-100 to-pink-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Sparkles className="w-8 h-8 text-violet-500" />
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-2">{t('fin_ai_analyzing')}</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
            {t('fin_ai_analyze_desc')}
          </p>
          <button
            onClick={generateInsights}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {t('fin_ai_generate')}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-20">
          <Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">{t('fin_ai_loading')}</p>
        </div>
      )}

      {insights && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">{t('fin_ai_title')}</h3>
            <button
              onClick={generateInsights}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              {t('fin_ai_regenerate')}
            </button>
          </div>
          {insights.map((insight, idx) => (
            <div key={idx} className={cn('rounded-xl border p-5', insight.color)}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-white/70 flex items-center justify-center">
                  {insight.icon}
                </div>
                <h4 className="text-sm font-semibold text-gray-900">{insight.title}</h4>
              </div>
              <ul className="space-y-1.5">
                {insight.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0 mt-1.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Opportunities Tab ─────────────────────────────────────────────────────────

function OpportunitiesTab({
  opportunities,
  setOpportunities,
}: {
  opportunities: Opportunity[]
  setOpportunities: React.Dispatch<React.SetStateAction<Opportunity[]>>
}) {
  const { t } = useLanguage()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [requirements, setRequirements] = useState('')
  const [notes, setNotes] = useState('')

  function openAdd() {
    setEditId(null); setName(''); setRequirements(''); setNotes(''); setShowForm(true)
  }

  function openEdit(o: Opportunity) {
    setEditId(o.id); setName(o.name); setRequirements(o.requirements ?? ''); setNotes(o.notes ?? ''); setShowForm(true)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const payload = { name: name.trim(), requirements: requirements.trim() || null, notes: notes.trim() || null }
    if (editId) {
      const res = await finApi('finance_opportunities', 'update', payload, editId)
      if (res.error) { toast.error(res.error) }
      else {
        setOpportunities(prev => prev.map(o => o.id === editId ? { ...o, ...payload } : o))
        toast.success('Updated!')
        setShowForm(false)
      }
    } else {
      const res = await finApi('finance_opportunities', 'insert', payload)
      if (res.error) { toast.error(res.error) }
      else {
        setOpportunities(prev => [res.data as Opportunity, ...prev])
        toast.success('Opportunity added!')
        setShowForm(false)
      }
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm(t('fin_opp_delete_confirm'))) return
    const res = await finApi('finance_opportunities', 'delete', undefined, id)
    if (res.error) { toast.error(res.error) }
    else { setOpportunities(prev => prev.filter(o => o.id !== id)); toast.success('Deleted!') }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{t('fin_opportunities')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t('fin_opp_desc')}</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('fin_opp_add')}
        </button>
      </div>

      <DialogOverlay show={showForm} onClose={() => setShowForm(false)} title={editId ? t('fin_opp_edit') : t('fin_opp_add')}>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('fin_opp_name')} *</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder={t('fin_opp_name_ph')} />
          </div>
          <div>
            <label className={labelCls}>{t('fin_opp_requirements')}</label>
            <textarea className={inputCls} rows={3} value={requirements} onChange={e => setRequirements(e.target.value)} placeholder={t('fin_opp_req_ph')} />
          </div>
          <div>
            <label className={labelCls}>{t('fin_notes')}</label>
            <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('fin_notes_ph')} />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />{t('saving')}...</> : t('save')}
          </button>
        </div>
      </DialogOverlay>

      {opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Lightbulb className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{t('fin_opp_empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opportunities.map(opp => (
            <div key={opp.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{opp.name}</p>
                  {opp.requirements && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-gray-500 mb-1">{t('fin_opp_requirements')}</p>
                      <p className="text-sm text-gray-700 bg-amber-50 rounded-lg px-3 py-2">{opp.requirements}</p>
                    </div>
                  )}
                  {opp.notes && (
                    <p className="text-xs text-gray-400 mt-2">{opp.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(opp)} className="p-1.5 rounded-md hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(opp.id)} className="p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab Definitions (outside component) ─────────────────────────────────────

type TabKey = 'dues' | 'income' | 'goals' | 'stats' | 'ai' | 'opportunities'

interface TabDef {
  key: TabKey
  labelKey: string
  icon: React.ReactNode
}

const TABS: TabDef[] = [
  { key: 'dues', labelKey: 'fin_dues', icon: <CreditCard className="w-4 h-4" /> },
  { key: 'income', labelKey: 'fin_income', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'goals', labelKey: 'fin_goals', icon: <Target className="w-4 h-4" /> },
  { key: 'opportunities', labelKey: 'fin_opportunities', icon: <Lightbulb className="w-4 h-4" /> },
  { key: 'stats', labelKey: 'fin_stats', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'ai', labelKey: 'fin_ai', icon: <Sparkles className="w-4 h-4" /> },
]

// ─── Main Component ────────────────────────────────────────────────────────────

export function FinancesClient({
  initialDues,
  initialIncome,
  initialGoals,
  initialOpportunities,
}: FinancesClientProps) {
  const { t, isRtl } = useLanguage()

  const [activeTab, setActiveTab] = useState<TabKey>('dues')
  const [dues, setDues] = useState<Due[]>(initialDues)
  const [income, setIncome] = useState<Income[]>(initialIncome)
  const [goals, setGoals] = useState<FinGoal[]>(initialGoals)
  const [opportunities, setOpportunities] = useState<Opportunity[]>(initialOpportunities)

  return (
    <div className="p-8" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className={cn('flex items-center justify-between mb-8', isRtl && 'flex-row-reverse')}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('finances_title')}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {dues.length} {t('fin_dues_label')} · {income.length} {t('fin_income_sources')} · {goals.length} {t('fin_goals_label')}
          </p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-7 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {tab.icon}
            {t(tab.labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dues' && (
        <DuesTab dues={dues} setDues={setDues} />
      )}
      {activeTab === 'income' && (
        <IncomeTab income={income} setIncome={setIncome} />
      )}
      {activeTab === 'goals' && (
        <GoalsTab goals={goals} setGoals={setGoals} />
      )}
      {activeTab === 'opportunities' && (
        <OpportunitiesTab opportunities={opportunities} setOpportunities={setOpportunities} />
      )}
      {activeTab === 'stats' && (
        <StatsTab dues={dues} income={income} />
      )}
      {activeTab === 'ai' && (
        <AITab dues={dues} income={income} goals={goals} />
      )}
    </div>
  )
}
