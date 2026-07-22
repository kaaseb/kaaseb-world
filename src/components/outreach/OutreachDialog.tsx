'use client'

// The outreach composer. Opens from an opportunity/company card, loads the saved
// template, fills the placeholders LOCALLY so the sender reads the exact text
// that will leave, lets them edit it for this one send, and mails it.
//
// Deliberately a two-step action: the card button only OPENS this; nothing is
// sent until "Send" is pressed here. Mailing a real customer must never be a
// single stray click.

import { useEffect, useState } from 'react'
import { Loader2, Mail, Paperclip, Send, X, AlertTriangle, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/LanguageContext'
import { renderOutreach } from '@/lib/outreach/render'

interface Props {
  open: boolean
  onClose: () => void
  type: 'opportunity' | 'company'
  id: string
  /** Placeholder values — owner (opportunity) or name (company). */
  company: string
  project?: string
  city?: string
  contactName?: string
  /** EVERY contact on the record — each address becomes a tickable recipient. */
  contacts?: Array<{ name?: string; role?: string; email?: string }>
  /** Called after a successful send so the parent can flip the card to contacted. */
  onSent: () => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function OutreachDialog({
  open, onClose, type, id, company, project, city, contactName, contacts, onSent,
}: Props) {
  const { isRtl, lang } = useLanguage()
  const ar = lang === 'ar'

  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  // Extra addresses typed by hand (comma/؛ separated) on top of the ticked ones.
  const [to, setTo] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [profileName, setProfileName] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const run = setTimeout(() => {
      setLoading(true)
      setTo('')
      // Every address on the record starts TICKED — procurement, head office and
      // the suppliers desk are all worth reaching; untick what you don't want.
      setPicked(
        Array.from(new Set(
          (contacts || [])
            .map((c) => (c.email || '').trim())
            .filter((e) => EMAIL_RE.test(e))
            .map((e) => e.toLowerCase()),
        )),
      )
      fetch('/api/outreach')
        .then((r) => r.json())
        .then((j) => {
          if (!alive || !j.template) return
          const vars = { contact: contactName || '', company, project: project || '', city: city || '' }
          setSubject(renderOutreach(j.template.subject || '', vars))
          setBody(renderOutreach(j.template.body || '', vars))
          setProfileName(j.template.profileName || null)
        })
        .catch(() => { if (alive) toast.error(ar ? 'تعذّر تحميل القالب' : 'Could not load template') })
        .finally(() => { if (alive) setLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(run) }
  }, [open, contacts, company, project, city, contactName, ar])

  if (!open) return null

  // Everyone who will actually receive it = ticked chips + hand-typed extras.
  const typed = to.split(/[;,\n]/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s))
  const recipients = Array.from(new Set([...picked, ...typed.map((e) => e.toLowerCase())]))
  const canSend = recipients.length > 0
  const withEmail = (contacts || []).filter((c) => EMAIL_RE.test((c.email || '').trim()))

  function toggle(mail: string) {
    const k = mail.toLowerCase()
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }

  async function send() {
    if (!canSend || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, to: recipients, subject, body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || (ar ? 'فشل الإرسال' : 'Send failed'), { duration: 10000 }); return }
      toast.success(
        j.attached
          ? (ar ? 'أُرسلت الرسالة مع البروفايل ✓' : 'Sent with the profile ✓')
          : (ar ? 'أُرسلت الرسالة (بدون مرفق البروفايل)' : 'Sent (no profile attached)'),
      )
      onSent()
      onClose()
    } catch {
      toast.error(ar ? 'فشل الإرسال' : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{ar ? 'إرسال تعريف الشركة' : 'Send company profile'}</p>
              <p className="text-xs text-muted-foreground truncate">{company}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-gray-900 flex-shrink-0"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {ar ? 'جاري التحميل…' : 'Loading…'}
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-700">
                {ar ? 'إلى' : 'To'} — {recipients.length} {ar ? 'مستلِم' : 'recipient(s)'}
              </span>

              {/* Every address on the record. All ticked by default; untick any. */}
              {withEmail.length > 0 && (
                <div className="flex flex-col gap-1">
                  {withEmail.map((c, i) => {
                    const mail = (c.email || '').trim()
                    const on = picked.includes(mail.toLowerCase())
                    return (
                      <button
                        type="button" key={`${mail}-${i}`} onClick={() => toggle(mail)}
                        className={`flex items-center gap-2 rounded-lg border p-2 text-start transition ${on ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300'}`}>
                          {on && <Check className="w-3 h-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 truncate" dir="ltr">{mail}</span>
                          {(c.name || c.role) && (
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {[c.name, c.role].filter(Boolean).join(' — ')}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              <input
                type="text" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)}
                placeholder={ar ? 'إضافة بريد آخر (افصل بفاصلة)' : 'Add another email (comma separated)'}
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              {!canSend && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{ar ? 'اختر مستلِماً واحداً على الأقل' : 'Pick at least one recipient'}
                </span>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">{ar ? 'الموضوع' : 'Subject'}</span>
              <input
                type="text" dir="ltr" value={subject} onChange={(e) => setSubject(e.target.value)}
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-700">{ar ? 'الرسالة (قابلة للتعديل)' : 'Message (editable)'}</span>
              <textarea
                dir="ltr" rows={14} value={body} onChange={(e) => setBody(e.target.value)}
                className="rounded-lg border border-gray-200 p-3 text-sm leading-relaxed outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-y"
              />
            </label>

            <div className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${profileName ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
              <Paperclip className="w-3.5 h-3.5 flex-shrink-0" />
              {profileName
                ? <span className="truncate">{ar ? 'مرفق: ' : 'Attached: '}{profileName}</span>
                : <span>{ar ? 'ما فيه بروفايل مرفوع — ارفعه من الإعدادات ليُرفق تلقائياً.' : 'No profile uploaded — add it in Settings to attach it automatically.'}</span>}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose} disabled={sending}>{ar ? 'إلغاء' : 'Cancel'}</Button>
              <Button onClick={send} disabled={!canSend || sending} className="gap-2">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? (ar ? 'جاري الإرسال…' : 'Sending…') : (ar ? 'إرسال' : 'Send')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
