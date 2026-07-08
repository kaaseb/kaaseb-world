'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ShieldAlert, Plus, ChevronUp, ChevronDown, History, Users, Star, Loader2, Search } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { TimeAgo } from '@/components/ui/time-ago'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { LedgerEntry } from '@/app/(dashboard)/points/page'

interface Props {
  currentUser: Profile
  profiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'total_points' | 'role'>[]
  initLedger: LedgerEntry[]
}

export function PointsManagementTab({ currentUser, profiles: initProfiles, initLedger }: Props) {
  const { t } = useLanguage()
  const supabase = createClient()
  const [profiles, setProfiles] = useState(initProfiles)
  const [ledger, setLedger] = useState(initLedger)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'grant' | 'deduct'>('grant')
  const [targetId, setTargetId] = useState<string>('')
  const [points, setPoints] = useState('10')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return profiles
    const q = search.toLowerCase()
    return profiles.filter(p => (p.full_name || '').toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [profiles, search])

  function openGrant() { setMode('grant'); setPoints('10'); setReason(''); setTargetId(''); setDialogOpen(true) }

  async function submitGrant(e: React.FormEvent) {
    e.preventDefault()
    if (!targetId) { toast.error(t('points_pick_user')); return }
    const raw = Math.abs(Number(points) || 0)
    if (raw <= 0) { toast.error(t('points_invalid_amount')); return }
    if (!reason.trim()) { toast.error(t('points_reason_required')); return }

    setSaving(true)
    const signed = mode === 'grant' ? raw : -raw
    const target = profiles.find(p => p.id === targetId)
    if (!target) { setSaving(false); return }

    // 1) Log in pending_points as 'approved'
    const { error: logErr } = await supabase.from('pending_points').insert({
      user_id: targetId,
      user_name: target.full_name,
      user_email: target.email,
      action_type: mode === 'grant' ? 'manual_grant' : 'manual_deduct',
      object_type: 'manual',
      object_name: reason.trim(),
      points: signed,
      status: 'approved',
      reviewed_by: currentUser.id,
      reviewed_at: new Date().toISOString(),
    })
    if (logErr) { toast.error(logErr.message); setSaving(false); return }

    // 2) Update total_points (optimistic)
    const newPoints = Math.max(0, target.total_points + signed)
    const { error: updErr } = await supabase.from('profiles').update({ total_points: newPoints }).eq('id', targetId)
    if (updErr) { toast.error(updErr.message); setSaving(false); return }

    setProfiles(ps => ps.map(p => p.id === targetId ? { ...p, total_points: newPoints } : p).sort((a, b) => b.total_points - a.total_points))

    // Fetch back the inserted ledger row (so UI has the id + created_at)
    const { data: latest } = await supabase
      .from('pending_points')
      .select('id, user_id, user_name, user_email, action_type, object_type, object_name, points, status, created_at, reviewed_by, reviewed_at')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(1)
    if (latest && latest[0]) setLedger([latest[0] as LedgerEntry, ...ledger])

    toast.success(mode === 'grant' ? t('points_granted') : t('points_deducted'))
    setDialogOpen(false)
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      {/* Hero management card */}
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-white p-6 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-gray-900">{t('points_mgmt_title')}</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-xl">{t('points_mgmt_desc')}</p>
        </div>
        <button
          onClick={openGrant}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-md transition-shadow"
        >
          <Plus className="w-4 h-4" />{t('points_grant_or_deduct')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Balances */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-5 flex items-center justify-between border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">{t('points_balances')}</h3>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute start-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('search')}
                className="h-8 ps-8 pe-3 text-xs rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-blue-300 outline-none"
              />
            </div>
          </div>
          <ul className="divide-y divide-gray-100 max-h-[560px] overflow-y-auto">
            {filteredProfiles.map((u, i) => (
              <li key={u.id} className="px-5 py-3 flex items-center gap-3">
                <span className="w-7 text-center text-xs text-gray-400 font-semibold flex-shrink-0">{i + 1}</span>
                <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {u.avatar_url
                    ? <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xs font-bold text-gray-500">{(u.full_name || u.email || 'U')[0].toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-amber-600 tabular-nums">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                  {u.total_points.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Ledger */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-5 flex items-center gap-2 border-b border-gray-100">
            <History className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">{t('points_global_ledger')}</h3>
          </div>
          {ledger.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">{t('points_log_empty')}</div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-[560px] overflow-y-auto">
              {ledger.map(l => {
                const positive = l.points >= 0
                return (
                  <li key={l.id} className="px-5 py-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      positive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                    }`}>
                      {positive ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{l.object_name || l.action_type}</p>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                        <span className="truncate">{l.user_name || l.user_email}</span>
                        <span>·</span>
                        <TimeAgo iso={l.created_at} />
                      </div>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                      {positive ? '+' : ''}{l.points}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Grant/Deduct dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('points_grant_or_deduct')}</DialogTitle></DialogHeader>
          <form onSubmit={submitGrant} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('grant')}
                className={`p-3 rounded-xl border text-sm font-semibold transition-colors ${
                  mode === 'grant' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <ChevronUp className="w-4 h-4 inline" /> {t('points_grant')}
              </button>
              <button
                type="button"
                onClick={() => setMode('deduct')}
                className={`p-3 rounded-xl border text-sm font-semibold transition-colors ${
                  mode === 'deduct' ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <ChevronDown className="w-4 h-4 inline" /> {t('points_deduct')}
              </button>
            </div>
            <div className="space-y-1.5">
              <Label>{t('points_user')} *</Label>
              <select
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                required
              >
                <option value="">—</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('points_amount')} *</Label>
              <Input type="number" min="1" value={points} onChange={e => setPoints(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('points_reason')} *</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder={t('points_reason_ph')} required />
            </div>
            <Button type="submit" disabled={saving} className={`w-full ${mode === 'grant' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : (mode === 'grant' ? t('points_grant') : t('points_deduct'))}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
