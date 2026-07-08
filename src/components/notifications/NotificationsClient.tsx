'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Bell, Plus, Loader2, Globe } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { arSA } from 'date-fns/locale'
import type { Profile } from '@/types'
import { useLanguage } from '@/contexts/LanguageContext'

interface Notification {
  id: string
  title: string
  message: string
  is_broadcast: boolean
  read_at: string | null
  created_at: string
  profiles: { full_name: string | null; avatar_url: string | null } | null
}

interface NotificationsClientProps {
  notifications: Notification[]
  profile: Profile
}

export function NotificationsClient({ notifications: initialNotifs, profile }: NotificationsClientProps) {
  const { t, isRtl, lang } = useLanguage()
  const [notifications, setNotifications] = useState(initialNotifs)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const isSuperAdmin = profile.role === 'super_admin'

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const { data, error } = await supabase
      .from('notifications')
      .insert({ title, message, sender_id: profile.id, is_broadcast: true })
      .select(`*, profiles!sender_id(full_name, avatar_url)`)
      .single()

    if (error) { toast.error('Failed to send notification') }
    else {
      setNotifications([data, ...notifications])
      setCreateOpen(false)
      setTitle(''); setMessage('')
      toast.success('Notification sent to all users!')
    }
    setLoading(false)
  }

  async function markRead(id: string) {
    const readAt = new Date().toISOString()
    await supabase.from('notifications').update({ read_at: readAt }).eq('id', id)
    setNotifications(notifications.map(n => n.id === id ? { ...n, read_at: readAt } : n))
  }

  const unread = notifications.filter(n => !n.read_at)

  return (
    <div className="p-8 max-w-2xl">
      <div className={`flex items-center justify-between mb-8 ${isRtl ? 'flex-row-reverse' : ''}`}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('notifications_title')}</h1>
          {unread.length > 0 && (
            <p className="text-gray-500 mt-1">{unread.length} {t('notification_unread')}</p>
          )}
        </div>
        {isSuperAdmin && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
              <Plus className="w-4 h-4" />{t('notification_new')}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t('notification_broadcast')}</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>{t('title')}</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('title')} required />
                </div>
                <div className="space-y-2">
                  <Label>{t('notification_message')}</Label>
                  <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t('notification_msg_ph')} rows={4} required />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('loading')}</> : t('notification_send')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-24">
          <Bell className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('no_data')}</h3>
          <p className="text-gray-400 text-sm">{t('notification_catchup')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => (
            <Card
              key={notif.id}
              className={`border-0 shadow-sm cursor-pointer transition-all hover:shadow-md ${!notif.read_at ? 'border-l-2 border-l-blue-500' : ''}`}
              onClick={() => !notif.read_at && markRead(notif.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${notif.is_broadcast ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    {notif.is_broadcast ? (
                      <Globe className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Bell className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-semibold ${!notif.read_at ? 'text-gray-900' : 'text-gray-600'}`}>
                        {notif.title}
                      </p>
                      {!notif.read_at && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{notif.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {notif.profiles?.full_name || 'System'} · {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: lang === 'ar' ? arSA : undefined })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
