'use client'

// The reading + verify + reply drawer for one email/thread.
//
//   • Left  — the FULL message: the sanitized HTML body in a sandboxed iframe
//     (no scripts), every attachment, and every link found in the email so the
//     team can check the cloud files.
//   • Right — the AI-extracted info (project name / summary / highlights /
//     requested terms), EDITABLE so the team fixes anything wrong before it feeds
//     the project.
//   • Reply — email the customer back (Arabic or English), prefilled from the
//     saved acknowledgment template, still editable per-send.
//
// Opening the drawer marks the thread read. The body is fetched per-email (the
// list is kept light) and the message is hydrated on demand if needed.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Loader2, Paperclip, LinkIcon, Send, Save, Sparkles, Mail, CalendarDays,
  ListChecks, FileText, ExternalLink, Languages,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { InboxEmail, EmailPreview } from '@/lib/inbox/store'

interface Props {
  headId: string
  fromEmail: string
  subject: string
  lang: 'ar' | 'en'
  isRtl: boolean
  canReply: boolean
  autoReply: boolean // open with the reply composer prefilled (after convert)
  onClose: () => void
  onPatched: (email: InboxEmail) => void
  onReplied: (repliedAt: string) => void
}

const emptyPreview: EmailPreview = { projectName: '', summary: '', highlights: [], requirements: [] }

export function InboxReader({
  headId, fromEmail, subject, lang, isRtl, canReply, autoReply,
  onClose, onPatched, onReplied,
}: Props) {
  const ar = lang === 'ar'
  const t = (a: string, e: string) => (ar ? a : e)

  const [email, setEmail] = useState<InboxEmail | null>(null)
  const [loading, setLoading] = useState(true)
  const [hydrating, setHydrating] = useState(false)

  // Editable extracted info (verify-and-fix)
  const [pv, setPv] = useState<EmailPreview>(emptyPreview)
  const [savingPv, setSavingPv] = useState(false)

  // Reply composer
  const [replyOpen, setReplyOpen] = useState(autoReply)
  const [replyLang, setReplyLang] = useState<'ar' | 'en'>(ar ? 'ar' : 'en')
  const [replySubject, setReplySubject] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const templateLoaded = useRef(false)

  const applyEmail = useCallback((e: InboxEmail) => {
    setEmail(e)
    setPv({
      projectName: e.preview?.projectName || '',
      summary: e.preview?.summary || '',
      highlights: e.preview?.highlights || [],
      requirements: e.preview?.requirements || [],
    })
  }, [])

  // Load the full email + mark the thread read.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/inbox/${encodeURIComponent(headId)}`)
        const j = await res.json().catch(() => ({}))
        if (alive && res.ok && j.email) applyEmail(j.email as InboxEmail)
      } catch { /* ignore */ }
      finally { if (alive) setLoading(false) }
      // Fire-and-forget: mark read.
      try {
        const res = await fetch(`/api/inbox/${encodeURIComponent(headId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        })
        const j = await res.json().catch(() => ({}))
        if (alive && res.ok && j.email) onPatched(j.email as InboxEmail)
      } catch { /* ignore */ }
    })()
    return () => { alive = false }
  }, [headId, applyEmail, onPatched])

  // Prefill the reply from the saved acknowledgment template (once).
  const loadTemplate = useCallback(async (which: 'ar' | 'en') => {
    try {
      const res = await fetch('/api/inbox/ack-template')
      const j = await res.json().catch(() => ({}))
      const tpl = j.template?.[which]
      if (tpl) { setReplySubject(tpl.subject || ''); setReplyBody(tpl.body || '') }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (replyOpen && !templateLoaded.current) {
      templateLoaded.current = true
      loadTemplate(replyLang)
    }
  }, [replyOpen, replyLang, loadTemplate])

  async function hydrate() {
    setHydrating(true)
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(headId)}/hydrate`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed', { duration: 8000 }); return }
      if (j.email) { applyEmail(j.email as InboxEmail); onPatched(j.email as InboxEmail) }
    } catch { toast.error('Failed') } finally { setHydrating(false) }
  }

  async function savePreview() {
    setSavingPv(true)
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(headId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: pv }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed'); return }
      if (j.email) { setEmail(j.email as InboxEmail); onPatched(j.email as InboxEmail) }
      toast.success(t('حُفظ ✓', 'Saved ✓'))
    } catch { toast.error('Failed') } finally { setSavingPv(false) }
  }

  async function send() {
    if (!replyBody.trim()) { toast.error(t('الرسالة فارغة', 'Message is empty')); return }
    setSending(true)
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(headId)}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: replyLang, subject: replySubject, body: replyBody }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j.error || 'Failed', { duration: 10000 }); return }
      toast.success(t('تم إرسال الرد ✓', 'Reply sent ✓'))
      if (j.repliedAt) onReplied(j.repliedAt)
      setReplyOpen(false)
    } catch { toast.error('Failed') } finally { setSending(false) }
  }

  const hydrated = !!email?.hydrated
  const links = email?.links || []
  const attachments = email?.attachments || []

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="w-full max-w-4xl h-full bg-background shadow-2xl flex flex-col animate-in slide-in-from-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 leading-snug truncate">{pv.projectName || subject}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{fromEmail}</span>
              {email?.date && <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{new Date(email.date).toLocaleString(ar ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 grid lg:grid-cols-2 gap-4">
            {/* ── LEFT: the real email ─────────────────────────────────── */}
            <div className="space-y-3 min-w-0">
              {!hydrated ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <Sparkles className="w-6 h-6 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">{t('لم تُجهَّز بعد — حمّل الرسالة كاملة والمرفقات', 'Not prepared yet — fetch the full message + attachments')}</p>
                  <Button size="sm" onClick={hydrate} disabled={hydrating} className="gap-1.5">
                    {hydrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {t('تجهيز', 'Prepare')}
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />{t('نص الرسالة', 'Message body')}</p>
                    {email?.bodyHtml ? (
                      <iframe
                        title="email-body"
                        sandbox=""
                        srcDoc={email.bodyHtml}
                        className="w-full h-[320px] rounded-lg border bg-white"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap text-sm text-gray-700 rounded-lg border bg-white p-3 max-h-[320px] overflow-auto font-sans">{email?.bodyText || t('(لا يوجد نص)', '(no text)')}</pre>
                    )}
                  </div>

                  {attachments.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" />{t('المرفقات', 'Attachments')} ({attachments.length})</p>
                      <div className="flex flex-col gap-1">
                        {attachments.map((a, i) => (
                          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-1.5 rounded border bg-muted/30 hover:bg-muted/60 text-xs">
                            <Paperclip className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="truncate flex-1">{a.name}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{a.category}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {links.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5"><LinkIcon className="w-3.5 h-3.5" />{t('الروابط في الرسالة', 'Links in the message')} ({links.length})</p>
                      <div className="flex flex-col gap-1">
                        {links.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 p-1.5 rounded border bg-sky-50/60 hover:bg-sky-100/60 text-xs text-sky-800" title={u}>
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            <span dir="ltr" className="truncate flex-1">{u}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── RIGHT: editable extracted info + reply ────────────────── */}
            <div className="space-y-3 min-w-0">
              <div className="rounded-lg border p-3 space-y-2.5">
                <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-blue-600" />{t('المعلومات المستخرجة (قابلة للتعديل)', 'Extracted info (editable)')}</p>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t('اسم المشروع', 'Project name')}</span>
                  <input value={pv.projectName} onChange={(e) => setPv({ ...pv, projectName: e.target.value })} className="w-full h-8 rounded-md border px-2 text-sm bg-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t('الملخص', 'Summary')}</span>
                  <textarea value={pv.summary} onChange={(e) => setPv({ ...pv, summary: e.target.value })} rows={3} className="w-full rounded-md border px-2 py-1 text-sm bg-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t('أبرز النقاط (سطر لكل نقطة)', 'Highlights (one per line)')}</span>
                  <textarea value={pv.highlights.join('\n')} onChange={(e) => setPv({ ...pv, highlights: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} rows={3} className="w-full rounded-md border px-2 py-1 text-sm bg-white" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t('الشروط المطلوبة (سطر لكل شرط)', 'Requested terms (one per line)')}</span>
                  <textarea value={pv.requirements.join('\n')} onChange={(e) => setPv({ ...pv, requirements: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} rows={3} className="w-full rounded-md border px-2 py-1 text-sm bg-white" />
                </label>
                <Button size="sm" onClick={savePreview} disabled={savingPv || !hydrated} className="gap-1.5">
                  {savingPv ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {t('حفظ التعديلات', 'Save edits')}
                </Button>
              </div>

              {/* Reply */}
              {canReply && (
                <div className="rounded-lg border p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-emerald-600" />{t('الرد على العميل', 'Reply to client')}</p>
                    {email?.repliedAt && <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">{t('تم الرد', 'Replied')}</span>}
                  </div>
                  {!replyOpen ? (
                    <Button size="sm" variant="outline" onClick={() => setReplyOpen(true)} className="gap-1.5">
                      <Send className="w-3.5 h-3.5" />{t('كتابة رد', 'Compose reply')}
                    </Button>
                  ) : (
                    <>
                      <div className="inline-flex rounded-lg border p-0.5 text-xs">
                        {(['ar', 'en'] as const).map((l) => (
                          <button key={l} onClick={() => { setReplyLang(l); loadTemplate(l) }} className={`px-3 py-1 rounded-md flex items-center gap-1 ${replyLang === l ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}`}>
                            <Languages className="w-3 h-3" />{l === 'ar' ? 'عربي' : 'EN'}
                          </button>
                        ))}
                      </div>
                      <input value={replySubject} onChange={(e) => setReplySubject(e.target.value)} placeholder={t('الموضوع', 'Subject')} className="w-full h-8 rounded-md border px-2 text-sm bg-white" dir={replyLang === 'ar' ? 'rtl' : 'ltr'} />
                      <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={7} placeholder={t('نص الرسالة…', 'Message…')} className="w-full rounded-md border px-2 py-1.5 text-sm bg-white" dir={replyLang === 'ar' ? 'rtl' : 'ltr'} />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={send} disabled={sending} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          {t('إرسال', 'Send')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => loadTemplate(replyLang)} className="gap-1.5 text-muted-foreground">
                          {t('إعادة تحميل القالب', 'Reload template')}
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{t('يُرسَل من info@kaaseb.sa إلى', 'Sent from info@kaaseb.sa to')} <span dir="ltr">{fromEmail}</span></p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
