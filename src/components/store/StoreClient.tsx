'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Plus, ShoppingBag, Zap, Loader2, Package, Trash2, Image as ImageIcon, CheckCircle2, Clock, Truck, Edit, Star, HandMetal } from 'lucide-react'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface Reward {
  id: string
  name: string
  description: string | null
  image_url: string | null
  required_points: number
  stock: number | null
}

interface Order {
  id: string
  status: 'pending' | 'approved' | 'delivered'
  created_at: string
  user_id: string
  reward_id: string
  rewards: { name: string; image_url: string | null; required_points: number } | null
  profiles: { full_name: string | null } | null
}

export function StoreClient({
  rewards: initRewards,
  orders: initOrders,
  profile,
  totalEarned = 0,
}: {
  rewards: Reward[]
  orders: Order[]
  profile: Profile
  totalEarned?: number
}) {
  const { t, isRtl } = useLanguage()

  const statusConfig = {
    pending: { label: t('status_pending'), color: 'bg-amber-100 text-amber-700', icon: Clock },
    approved: { label: t('store_approve'), color: 'bg-blue-100 text-blue-700', icon: CheckCircle2 },
    delivered: { label: t('store_delivered'), color: 'bg-green-100 text-green-700', icon: Truck },
  }

  const [rewards, setRewards] = useState(initRewards)
  const [orders, setOrders] = useState(initOrders)
  const [currentPoints, setCurrentPoints] = useState(profile.total_points)
  const [createOpen, setCreateOpen] = useState(false)
  const [editReward, setEditReward] = useState<Reward | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [requiredPoints, setRequiredPoints] = useState('100')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const editFileRef = useRef<HTMLInputElement>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editRequiredPoints, setEditRequiredPoints] = useState('100')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null)
  const supabase = createClient()
  const isSuperAdmin = profile?.role === 'super_admin'
  const myOrders = orders.filter(o => o.user_id === profile.id)
  // Rewards with an active (non-delivered) order by this user
  const activeOrderedRewardIds = new Set(
    myOrders.filter(o => o.status !== 'delivered').map(o => o.reward_id)
  )

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function handleCreateReward(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    let imageUrl: string | null = null

    if (imageFile) {
      const fd = new FormData()
      fd.append('file', imageFile)
      fd.append('kind', 'rewards')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const result = await res.json()
      if (result.url) imageUrl = result.url
      else toast.error('Image upload failed, saving without image')
    }

    const { data, error } = await supabase
      .from('rewards')
      .insert({
        name,
        description: description || null,
        required_points: parseInt(requiredPoints),
        image_url: imageUrl,
        created_by: profile.id,
      })
      .select()
      .single()

    if (error) { toast.error('Failed to create reward') }
    else {
      setRewards([...rewards, data])
      setCreateOpen(false)
      setName(''); setDescription(''); setRequiredPoints('100'); setImageFile(null); setImagePreview(null)
      toast.success('Reward created!')
    }
    setLoading(false)
  }

  async function handleOrder(rewardId: string, requiredPoints: number) {
    if (currentPoints < requiredPoints) {
      toast.error(`You need ${requiredPoints - currentPoints} more points`)
      return
    }
    if (!confirm(`Redeem this reward for ${requiredPoints} points?`)) return

    const newPoints = currentPoints - requiredPoints

    const { data, error } = await supabase
      .from('reward_orders')
      .insert({ reward_id: rewardId, user_id: profile.id })
      .select(`*, rewards(name, image_url, required_points), profiles!user_id(full_name)`)
      .single()

    if (error) { toast.error('Failed to place order'); return }

    // Deduct points from profile
    const { error: pointsError } = await supabase
      .from('profiles')
      .update({ total_points: newPoints })
      .eq('id', profile.id)

    if (pointsError) {
      toast.error('Order placed but points could not be deducted')
    } else {
      setCurrentPoints(newPoints)
    }

    setOrders([data, ...orders])
    toast.success(t('store_order_placed'))
  }

  async function handleStatusChange(orderId: string, status: string) {
    await supabase.from('reward_orders').update({ status }).eq('id', orderId)
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: status as Order['status'] } : o))
    toast.success('Status updated')
  }

  async function handleDeleteReward(id: string) {
    if (!confirm('Delete this reward?')) return
    await supabase.from('rewards').delete().eq('id', id)
    setRewards(rewards.filter(r => r.id !== id))
    toast.success('Reward deleted')
  }

  function openEditReward(reward: Reward) {
    setEditReward(reward)
    setEditName(reward.name)
    setEditDescription(reward.description ?? '')
    setEditRequiredPoints(String(reward.required_points))
    setEditImagePreview(reward.image_url)
    setEditImageFile(null)
  }

  async function handleUpdateReward(e: React.FormEvent) {
    e.preventDefault()
    if (!editReward) return
    setLoading(true)

    let imageUrl = editReward.image_url

    if (editImageFile) {
      const fd = new FormData()
      fd.append('file', editImageFile)
      fd.append('kind', 'rewards')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const result = await res.json()
      if (result.url) imageUrl = result.url
    }

    const { data, error } = await supabase
      .from('rewards')
      .update({
        name: editName,
        description: editDescription || null,
        required_points: parseInt(editRequiredPoints),
        image_url: imageUrl,
      })
      .eq('id', editReward.id)
      .select()
      .single()

    if (error) { toast.error('Failed to update reward') }
    else {
      setRewards(rewards.map(r => r.id === editReward.id ? data : r))
      setEditReward(null)
      toast.success(t('store_reward_updated'))
    }
    setLoading(false)
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 p-6 md:p-8 mb-6 text-white shadow-lg">
        {/* Decorative blobs */}
        <div className="absolute -top-16 -start-16 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-20 -end-20 w-64 h-64 rounded-full bg-white/5 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-stretch md:items-center gap-6 md:gap-8">
          {/* Title block (on the reading-direction start side) */}
          <div className="flex-1 min-w-0 text-start">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur text-xs font-medium mb-3">
              <HandMetal className="w-3.5 h-3.5" />
              {t('store_hero_pill')}
            </span>
            <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">
              {t('store_hero_title')} <span className="inline-block">🎁</span>
            </h1>
            <p className="text-sm md:text-base text-white/80 mt-2 max-w-xl">{t('store_hero_subtitle')}</p>
            {isSuperAdmin && (
              <button
                onClick={() => setCreateOpen(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-blue-700 text-sm font-semibold hover:bg-white/90 shadow transition-colors"
              >
                <Plus className="w-4 h-4" /> {t('store_add_reward')}
              </button>
            )}
          </div>

          {/* Balance card (on the end side) */}
          <div className="md:w-80 flex-shrink-0 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-xs text-white/80">{t('store_hero_available')}</span>
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold tabular-nums">{currentPoints.toLocaleString()}</span>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center text-white shadow ring-2 ring-white/30">
                  <span className="text-base font-bold">﷼</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between pt-3">
              <span className="text-xs text-white/80">{t('store_hero_earned')}</span>
              <span className="inline-flex items-center gap-1.5 text-base font-semibold">
                <Star className="w-4 h-4 fill-amber-300 text-amber-300" />
                {totalEarned.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="rewards">
        <TabsList className="mb-6">
          <TabsTrigger value="rewards">{t('store_rewards')} ({rewards.length})</TabsTrigger>
          <TabsTrigger value="my-orders">{t('store_my_orders')} ({myOrders.length})</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="all-orders">{t('store_all_orders')} ({orders.length})</TabsTrigger>}
        </TabsList>

        {/* REWARDS */}
        <TabsContent value="rewards">
          {rewards.length === 0 ? (
            <div className="text-center py-20">
              <ShoppingBag className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-400">{t('store_no_rewards')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {rewards.map(reward => {
                const canAfford = currentPoints >= reward.required_points
                const alreadyOrdered = activeOrderedRewardIds.has(reward.id)
                const disabled = !canAfford || alreadyOrdered
                return (
                  <div key={reward.id} className="bg-white rounded-2xl shadow-sm overflow-hidden group hover:shadow-md transition-shadow">
                    {/* Image */}
                    <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center overflow-hidden">
                      {reward.image_url ? (
                        <img
                          src={reward.image_url}
                          alt={reward.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-10 h-10 text-gray-300" />
                      )}
                      {isSuperAdmin && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => openEditReward(reward)}
                            className="w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center text-gray-400 hover:text-blue-500 shadow-sm"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteReward(reward.id)}
                            className="w-7 h-7 rounded-full bg-white/90 backdrop-blur flex items-center justify-center text-gray-400 hover:text-red-500 shadow-sm"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {alreadyOrdered && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <span className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded-full">{t('store_order_pending')}</span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <h3 className="font-semibold text-gray-900 text-sm truncate">{reward.name}</h3>
                      {reward.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{reward.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-3">
                        <span className={`flex items-center gap-1 text-sm font-bold ${canAfford && !alreadyOrdered ? 'text-amber-600' : 'text-gray-400'}`}>
                          <Zap className="w-3.5 h-3.5" />
                          {reward.required_points}
                        </span>
                        <button
                          disabled={disabled}
                          onClick={() => !disabled && handleOrder(reward.id, reward.required_points)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                            alreadyOrdered
                              ? 'bg-amber-100 text-amber-600 cursor-not-allowed'
                              : canAfford
                                ? 'bg-gray-900 text-white hover:bg-gray-800'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {alreadyOrdered ? t('store_ordered') : canAfford ? t('store_redeem') : t('store_not_enough')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* MY ORDERS */}
        <TabsContent value="my-orders">
          {myOrders.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-400">{t('store_no_orders')}</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl">
              {myOrders.map(order => {
                const cfg = statusConfig[order.status]
                const StatusIcon = cfg.icon
                return (
                  <div key={order.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {order.rewards?.image_url ? (
                        <img src={order.rewards.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{order.rewards?.name}</p>
                      <p className="text-xs text-gray-400">{order.rewards?.required_points} {t('points')}</p>
                    </div>
                    <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${cfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* ALL ORDERS (Admin) */}
        {isSuperAdmin && (
          <TabsContent value="all-orders">
            <div className="space-y-3">
              {orders.map(order => {
                const cfg = statusConfig[order.status]
                const StatusIcon = cfg.icon
                return (
                  <div key={order.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {order.rewards?.image_url ? (
                        <img src={order.rewards.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900">{order.rewards?.name}</p>
                      <p className="text-xs text-gray-400">{order.profiles?.full_name} · {order.rewards?.required_points} {t('user_pts')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${cfg.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {order.status === 'pending' && (
                        <button onClick={() => handleStatusChange(order.id, 'approved')} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors">
                          {t('store_approve')}
                        </button>
                      )}
                      {order.status === 'approved' && (
                        <button onClick={() => handleStatusChange(order.id, 'delivered')} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-colors">
                          {t('store_delivered')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Edit Reward Dialog */}
      <Dialog open={!!editReward} onOpenChange={open => { if (!open) { setEditReward(null); setEditImageFile(null); setEditImagePreview(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('store_edit_reward')}</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdateReward} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{t('store_reward_image')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
              <div
                onClick={() => editFileRef.current?.click()}
                className="relative aspect-video rounded-xl border-2 border-dashed border-gray-200 hover:border-gray-400 cursor-pointer overflow-hidden transition-colors flex items-center justify-center bg-gray-50"
              >
                {editImagePreview ? (
                  <img src={editImagePreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImageIcon className="w-8 h-8 mb-2" />
                    <p className="text-xs">{t('store_click_upload')}</p>
                  </div>
                )}
              </div>
              <input ref={editFileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                setEditImageFile(file)
                setEditImagePreview(URL.createObjectURL(file))
              }} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('name')}</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
              <Input value={editDescription} onChange={e => setEditDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('store_req_points')}</Label>
              <Input type="number" value={editRequiredPoints} onChange={e => setEditRequiredPoints(e.target.value)} min="1" required />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('saving')}...</> : t('save')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Reward Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) { setImageFile(null); setImagePreview(null) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('store_create_reward')}</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateReward} className="space-y-4 mt-2">
            {/* Image Upload */}
            <div className="space-y-1.5">
              <Label>{t('store_reward_image')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
              <div
                onClick={() => fileRef.current?.click()}
                className="relative aspect-video rounded-xl border-2 border-dashed border-gray-200 hover:border-gray-400 cursor-pointer overflow-hidden transition-colors flex items-center justify-center bg-gray-50"
              >
                {imagePreview ? (
                  <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImageIcon className="w-8 h-8 mb-2" />
                    <p className="text-xs">{t('store_click_upload')}</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>

            <div className="space-y-1.5">
              <Label>{t('name')}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Reward name" required />
            </div>
            <div className="space-y-1.5">
              <Label>{t('description')} <span className="text-gray-400 font-normal">({t('optional')})</span></Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('store_req_points')}</Label>
              <Input type="number" value={requiredPoints} onChange={e => setRequiredPoints(e.target.value)} min="1" required />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('creating')}...</> : t('store_create_reward')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
