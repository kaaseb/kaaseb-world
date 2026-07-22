'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Lock, Unlock, User, Shield, Camera, KeyRound, MessageSquareHeart, Sparkles, Award, Mail, Cloud, CheckCircle2, XCircle } from 'lucide-react'
import { BADGES } from '@/lib/badges'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'
import { FurnSettingsTab } from '@/components/furn/FurnSettingsTab'
import { FxSettingsTab } from '@/components/settings/FxSettingsTab'
import { TitanSettingsTab } from '@/components/integrations/TitanSettingsTab'
import { DeliverySettingsTab } from '@/components/furn/DeliverySettingsTab'
import { PreQualSettingsTab } from '@/components/pre-qualifications/PreQualSettingsTab'
import { AiSettingsTab } from '@/components/ai/AiSettingsTab'
import { OutreachSettingsCard } from '@/components/settings/OutreachSettingsCard'

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fullName, setFullName] = useState('')
  const [title, setTitle] = useState('')
  const [bio, setBio] = useState('')
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set())
  const [badgeProgress, setBadgeProgress] = useState<Record<string, number>>({})
  const [lockPassword, setLockPassword] = useState('')
  const [confirmLockPassword, setConfirmLockPassword] = useState('')
  const [settingLock, setSettingLock] = useState(false)
  const [disablingLock, setDisablingLock] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [employeesCanCreateDm, setEmployeesCanCreateDm] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  // Creation reward knobs (super-admin only). 0 disables; limit 0 = unlimited.
  const [postReward, setPostReward] = useState(0)
  const [postLimit, setPostLimit] = useState(0)
  const [storyReward, setStoryReward] = useState(0)
  const [storyLimit, setStoryLimit] = useState(0)
  const [savingRewards, setSavingRewards] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [testTo, setTestTo] = useState('it@ghassl.com')
  // S3 connection summary (super-admin only). Lazy-loaded from /api/s3-status
  // so we don't expose secrets in the page bundle.
  const [s3, setS3] = useState<null | {
    region: string | null
    bucket: string | null
    accessKey: string | null
    hasSecret: boolean
    publicUrl: string | null
    reachable: boolean | null
    reachError: string | null
  }>(null)
  const [s3Loading, setS3Loading] = useState(false)

  const { t, isRtl } = useLanguage()
  const supabase = createClient()

  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const [{ data }, { data: cfg }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('app_config').select('employees_can_create_dm, post_reward_points, post_reward_daily_limit, story_reward_points, story_reward_daily_limit').eq('id', 1).single(),
      ])
      if (data) {
        setProfile(data)
        setFullName(data.full_name || '')
        setTitle(data.title || '')
        setBio(data.bio || '')
      }
      if (cfg) {
        setEmployeesCanCreateDm(!!cfg.employees_can_create_dm)
        setPostReward(cfg.post_reward_points ?? 0)
        setPostLimit(cfg.post_reward_daily_limit ?? 0)
        setStoryReward(cfg.story_reward_points ?? 0)
        setStoryLimit(cfg.story_reward_daily_limit ?? 0)
      }
      setLoading(false)

      // Evaluate and unlock badges for this user
      try {
        const res = await fetch('/api/badges')
        if (res.ok) {
          const json = await res.json() as { earned: string[], progress: Record<string, number>, newlyEarned: string[] }
          setEarnedBadges(new Set(json.earned))
          setBadgeProgress(json.progress || {})
          if (json.newlyEarned && json.newlyEarned.length > 0) {
            const b = json.newlyEarned[0]
            toast.success(`${t('badge_new')} ${b}`)
          }
        }
      } catch { /* ignore */ }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ full_name: fullName, title: title || null, bio, updated_at: new Date().toISOString() }).eq('id', userId)
    if (error) { toast.error('Failed to save profile') }
    else { toast.success(t('settings_save_profile')) }
    setSaving(false)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', 'avatars')
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const result = await res.json()
    if (!result.url) { toast.error('Failed to upload photo'); setUploadingAvatar(false); return }
    if (!userId) return
    await supabase.from('profiles').update({ avatar_url: result.url }).eq('id', userId)
    setProfile(prev => prev ? { ...prev, avatar_url: result.url } : prev)
    toast.success(t('settings_avatar_saved'))
    setUploadingAvatar(false)
  }

  async function handleSetLock(e: React.FormEvent) {
    e.preventDefault()
    if (lockPassword !== confirmLockPassword) { toast.error('PINs do not match'); return }
    if (lockPassword.length !== 4 || !/^\d{4}$/.test(lockPassword)) { toast.error('PIN must be exactly 4 digits'); return }
    setSettingLock(true)
    const response = await fetch('/api/lock/set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: lockPassword }) })
    const result = await response.json()
    if (result.success) {
      toast.success('PIN set!')
      setProfile(prev => prev ? { ...prev, lock_enabled: true, lock_password_hash: 'set' } : prev)
      setLockPassword(''); setConfirmLockPassword('')
    } else { toast.error(result.error || 'Failed to set PIN') }
    setSettingLock(false)
  }

  async function handleDisableLock() {
    setDisablingLock(true)
    const response = await fetch('/api/lock/disable', { method: 'POST' })
    const result = await response.json()
    if (result.success) {
      toast.success('Dashboard lock disabled')
      setProfile(prev => prev ? { ...prev, lock_enabled: false } : prev)
    } else { toast.error('Failed to disable lock') }
    setDisablingLock(false)
  }

  async function handleToggleEmployeesDm(next: boolean) {
    if (!userId) return
    setSavingConfig(true)
    const prev = employeesCanCreateDm
    setEmployeesCanCreateDm(next)
    const { error } = await supabase
      .from('app_config')
      .update({ employees_can_create_dm: next, updated_at: new Date().toISOString(), updated_by: userId })
      .eq('id', 1)
    if (error) {
      setEmployeesCanCreateDm(prev)
      toast.error(error.message)
    } else {
      toast.success(t('saved'))
    }
    setSavingConfig(false)
  }

  async function loadS3Status() {
    setS3Loading(true)
    try {
      const res = await fetch('/api/s3-status')
      const j = await res.json()
      if (res.ok) setS3(j)
      else toast.error(j.error || 'Failed to read S3 status')
    } catch {
      toast.error('Network error')
    }
    setS3Loading(false)
  }

  useEffect(() => {
    if (profile?.role === 'super_admin') loadS3Status()
  }, [profile?.role])

  async function handleTestEmail() {
    setTestingEmail(true)
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      })
      const json = await res.json()
      if (json.ok) toast.success(`✉️ Sent to ${json.to}`)
      else toast.error(json.error || 'Failed')
    } catch {
      toast.error('Network error')
    }
    setTestingEmail(false)
  }

  async function handleSaveRewards(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setSavingRewards(true)
    const { error } = await supabase
      .from('app_config')
      .update({
        post_reward_points:       Math.max(0, postReward | 0),
        post_reward_daily_limit:  Math.max(0, postLimit  | 0),
        story_reward_points:      Math.max(0, storyReward | 0),
        story_reward_daily_limit: Math.max(0, storyLimit  | 0),
        updated_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('id', 1)
    setSavingRewards(false)
    if (error) toast.error(error.message)
    else toast.success(t('saved'))
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmNewPassword) { toast.error(t('settings_password_no_match')); return }
    if (newPassword.length < 6) { toast.error(t('settings_password_min')); return }
    setChangingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { toast.error(error.message) }
    else {
      // Also clear the one-shot flag in case this is the first password change
      // for an invited user who chose to do it from settings rather than the
      // welcome page.
      if (userId) {
        await supabase
          .from('profiles')
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq('id', userId)
      }
      toast.success(t('settings_password_changed'))
      setNewPassword('')
      setConfirmNewPassword('')
    }
    setChangingPassword(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('settings_title')}</h1>
        <p className="text-gray-500 mt-1">{t('settings_manage')}</p>
      </div>

      <div className="space-y-6">
        {/* Profile Settings */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="w-4 h-4" />
              {t('settings_profile')}
            </CardTitle>
            <CardDescription>{t('settings_profile_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Avatar */}
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-gray-600">
                      {(profile?.full_name || profile?.email || 'U')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gray-900 text-white flex items-center justify-center hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {uploadingAvatar ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                </button>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{t('settings_avatar')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('settings_avatar_click')}</p>
              </div>
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('full_name')}</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('settings_name_ph')} />
              </div>
              <div className="space-y-2">
                <Label>{t('settings_profile_title')}</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('settings_profile_title_ph')} maxLength={40} />
                <p className="text-xs text-gray-400">{t('settings_profile_title_hint')}</p>
              </div>
              <div className="space-y-2">
                <Label>{t('settings_bio')}</Label>
                <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('settings_bio_ph')} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>{t('role')}</Label>
                <Input value={profile?.role?.replace('_', ' ') || ''} disabled className="bg-gray-50 text-gray-500" />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}</> : t('settings_save_profile')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              {t('settings_change_password')}
            </CardTitle>
            <CardDescription>{t('settings_change_password_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('settings_new_password')}</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder={t('settings_new_password_ph')}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings_confirm_new_password')}</Label>
                <Input
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder={t('settings_confirm_password_ph')}
                  required
                />
              </div>
              <Button type="submit" disabled={changingPassword}>
                {changingPassword
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('settings_changing')}</>
                  : <><KeyRound className="w-4 h-4 mr-2" />{t('settings_change_password')}</>}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Dashboard Lock */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4" />
              {t('settings_lock')}
            </CardTitle>
            <CardDescription>{t('settings_lock_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {profile?.lock_enabled ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                  <Lock className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-900">{t('settings_lock_enabled_title')}</p>
                    <p className="text-xs text-green-600">{t('settings_lock_enabled_desc')}</p>
                  </div>
                </div>
                <Button variant="outline" onClick={handleDisableLock} disabled={disablingLock} className="text-red-600 border-red-200 hover:bg-red-50">
                  {disablingLock ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('disabling')}</> : <><Unlock className="w-4 h-4 mr-2" />{t('disable_lock')}</>}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSetLock} className="space-y-4">
                <div className="space-y-2">
                  <Label>PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    value={lockPassword}
                    onChange={(e) => setLockPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="● ● ● ●"
                    required
                    className="text-center text-lg tracking-[0.5em]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>PIN ({t('confirm')})</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    value={confirmLockPassword}
                    onChange={(e) => setConfirmLockPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="● ● ● ●"
                    required
                    className="text-center text-lg tracking-[0.5em]"
                  />
                </div>
                <Button type="submit" disabled={settingLock || lockPassword.length !== 4}>
                  {settingLock ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('enabling')}</> : <><Lock className="w-4 h-4 mr-2" />{t('settings_lock_set')}</>}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Badges & Achievements */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {t('badges_title')}
            </CardTitle>
            <CardDescription>{t('badges_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-gray-500 mb-3">
              {t('badges_earned_count').replace('{n}', String(earnedBadges.size)).replace('{total}', String(BADGES.length))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {BADGES.map(b => {
                const earned = earnedBadges.has(b.key)
                const p = Math.round((badgeProgress[b.key] ?? 0) * 100)
                return (
                  <div
                    key={b.key}
                    className={`relative rounded-xl border p-3 transition-all ${
                      earned
                        ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm'
                        : 'border-gray-100 bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`text-3xl flex-shrink-0 transition-all ${
                          earned ? '' : 'grayscale opacity-40'
                        }`}
                      >
                        {b.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${earned ? 'text-gray-900' : 'text-gray-500'}`}>
                          {isRtl ? b.label_ar : b.label_en}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                          {isRtl ? b.requirement_ar : b.requirement_en}
                        </p>
                        {!earned && p > 0 && (
                          <div className="mt-2">
                            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400" style={{ width: `${p}%` }} />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">{p}%</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {earned && (
                      <span className="absolute top-1.5 end-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center">
                        ✓
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Super-admin only: the outreach message + company profile attachment */}
        {profile?.role === 'super_admin' && <OutreachSettingsCard />}

        {/* Super-admin only: Community permissions */}
        {profile?.role === 'super_admin' && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MessageSquareHeart className="w-4 h-4 text-pink-500" />
                {t('settings_community')}
              </CardTitle>
              <CardDescription>{t('settings_community_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={employeesCanCreateDm}
                  onChange={e => handleToggleEmployeesDm(e.target.checked)}
                  disabled={savingConfig}
                  className="mt-0.5 accent-pink-600 w-4 h-4"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{t('settings_employees_dm')}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t('settings_employees_dm_desc')}</p>
                </div>
                {savingConfig && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-1" />}
              </label>
            </CardContent>
          </Card>
        )}

        {/* Super-admin only: S3 connection (read-only). Pulls from server env. */}
        {profile?.role === 'super_admin' && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Cloud className="w-4 h-4 text-sky-500" />
                {t('settings_s3_title')}
              </CardTitle>
              <CardDescription>{t('settings_s3_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {s3Loading && !s3 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('loading')}
                </div>
              ) : s3 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <S3Field label={t('settings_s3_bucket')} value={s3.bucket} />
                    <S3Field label={t('settings_s3_region')} value={s3.region} />
                    <S3Field label={t('settings_s3_access_key')} value={s3.accessKey} mono />
                    <S3Field
                      label={t('settings_s3_secret')}
                      value={s3.hasSecret ? '••••••••' : null}
                      mono
                    />
                    <S3Field
                      className="sm:col-span-2"
                      label={t('settings_s3_public_url')}
                      value={s3.publicUrl}
                      mono
                    />
                  </div>
                  <div
                    className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 border ${
                      s3.reachable === true
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : s3.reachable === false
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600'
                    }`}
                  >
                    {s3.reachable === true && <CheckCircle2 className="w-4 h-4" />}
                    {s3.reachable === false && <XCircle className="w-4 h-4" />}
                    {s3.reachable === null && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span className="font-medium">
                      {s3.reachable === true
                        ? t('settings_s3_connected')
                        : s3.reachable === false
                        ? t('settings_s3_not_connected')
                        : t('settings_s3_unknown')}
                    </span>
                    {s3.reachError && (
                      <span className="text-xs opacity-80 truncate">— {s3.reachError}</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadS3Status}
                    disabled={s3Loading}
                  >
                    {s3Loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {t('settings_s3_recheck')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('settings_s3_unknown')}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Super-admin only: Email test */}
        {profile?.role === 'super_admin' && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-500" />
                Email System
              </CardTitle>
              <CardDescription>اختبر اتصال SMTP بإرسال إيميل تجريبي.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <Label>To</Label>
                  <Input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="recipient@example.com"
                  />
                </div>
                <Button onClick={handleTestEmail} disabled={testingEmail || !testTo.includes('@')}>
                  {testingEmail
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />جاري الإرسال…</>
                    : <><Mail className="w-4 h-4 mr-2" />إرسال test</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Super-admin only: Creation rewards (posts & stories) */}
        {profile?.role === 'super_admin' && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                {t('settings_creation_rewards')}
              </CardTitle>
              <CardDescription>{t('settings_creation_rewards_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveRewards} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t('settings_post_reward')}</Label>
                    <Input
                      type="number" min={0}
                      value={postReward}
                      onChange={(e) => setPostReward(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings_post_limit')}</Label>
                    <Input
                      type="number" min={0}
                      value={postLimit}
                      onChange={(e) => setPostLimit(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                    <p className="text-[11px] text-gray-400">{t('settings_unlimited_hint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings_story_reward')}</Label>
                    <Input
                      type="number" min={0}
                      value={storyReward}
                      onChange={(e) => setStoryReward(Math.max(0, Number(e.target.value) || 0))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('settings_story_limit')}</Label>
                    <Input
                      type="number" min={0}
                      value={storyLimit}
                      onChange={(e) => setStoryLimit(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                    />
                    <p className="text-[11px] text-gray-400">{t('settings_unlimited_hint')}</p>
                  </div>
                </div>
                <Button type="submit" disabled={savingRewards}>
                  {savingRewards
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}</>
                    : <><Award className="w-4 h-4 mr-2" />{t('settings_save_rewards')}</>}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* AI engine — provider switch + OpenAI key (super-admin only) */}
        {profile?.role === 'super_admin' && (
          <AiSettingsTab />
        )}

        {/* USD exchange rate — Tannoor USD pricing */}
        {profile?.role === 'super_admin' && (
          <FxSettingsTab />
        )}

        {/* Titan email intake (IMAP) */}
        {profile?.role === 'super_admin' && (
          <TitanSettingsTab />
        )}

        {/* Furn (الفرن) — branding, defaults, departments */}
        {profile?.role === 'super_admin' && (
          <FurnSettingsTab />
        )}

        {/* Delivery sentences (included / not included) */}
        {profile?.role === 'super_admin' && (
          <DeliverySettingsTab />
        )}

        {/* Pre-qualification cover/back templates + TOC */}
        {profile?.role === 'super_admin' && (
          <PreQualSettingsTab />
        )}

      </div>
    </div>
  )
}

function S3Field({ label, value, mono, className }: {
  label: string
  value: string | null
  mono?: boolean
  className?: string
}) {
  return (
    <div className={`space-y-1 ${className || ''}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`text-sm rounded-md border bg-muted/30 px-2.5 py-1.5 truncate ${
          mono ? 'font-mono' : 'font-medium'
        } ${value ? 'text-foreground' : 'text-muted-foreground italic'}`}
        dir="ltr"
        title={value || ''}
      >
        {value || '—'}
      </p>
    </div>
  )
}
