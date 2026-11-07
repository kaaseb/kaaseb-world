'use client'

// «حملة المشاريع» — check the profile, check the message, press «إرسال».
// One email per company, sent one after another with live progress.

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Loader2, Mail, RotateCcw, Send, TriangleAlert, Eye, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_SUBJECT, DEFAULT_BODY, fill, varsFor, hasUnfilled, type CampaignTarget } from '@/lib/campaigns/stone-2026'
import type { SentRecord, FailRecord } from '@/lib/campaigns/store'

interface Data {
  targets: CampaignTarget[]
  subject: string
  body: string
  sent: Record<string, SentRecord>
  failed: Record<string, FailRecord>
  profile: { url: string | null; name: string | null; ok: boolean }
}

const day = (iso: string) => new Date(iso).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })

export function CampaignClient() {
  const [data, setData] = useState<Data | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [previewId, setPreviewId] = useState<string>('')
  const [sending, setSending] = useState<{ done: number; total: number; current: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  /** The exact email this company gets, to our own mailbox — not counted as sent. */
  async function sendTest(t: CampaignTarget) {
    setTesting(t.id)
    try {
      await saveText(subject, body)
      const r = await fetch('/api/campaigns/stone-2026/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: t.id, emails: t.emails.map((e) => e.email), test: true }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) toast.success(`وصلت نسخة على ${j.to}${j.savedToSent ? ' وانحفظت في المرسل' : ''}`)
      else toast.error(j.error || 'فشل')
    } catch { toast.error('انقطع الاتصال') } finally { setTesting(null) }
  }

  useEffect(() => {
    fetch('/api/campaigns/stone-2026').then((r) => r.json()).then((j: Data & { error?: string }) => {
      if (j.error) { toast.error(j.error); return }
      setData(j); setSubject(j.subject); setBody(j.body)
      // Default selection: the recommended addresses of companies not yet mailed.
      setPicked(Object.fromEntries(j.targets.filter((t) => !j.sent[t.id]).map((t) => [t.id, t.emails.filter((e) => e.recommended).map((e) => e.email)])))
      setPreviewId(j.targets[0]?.id || '')
    }).catch(() => toast.error('تعذّر تحميل الحملة'))
  }, [])

  async function saveText(s: string, b: string) {
    setSaved('saving')
    try {
      const r = await fetch('/api/campaigns/stone-2026', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: s === DEFAULT_SUBJECT ? null : s, body: b === DEFAULT_BODY ? null : b }) })
      setSaved(r.ok ? 'saved' : 'error')
    } catch { setSaved('error') }
  }

  const queue = useMemo(() => (data ? data.targets.filter((t) => !data.sent[t.id] && (picked[t.id] || []).length) : []), [data, picked])
  const preview = data?.targets.find((t) => t.id === previewId)
  const pSubject = preview ? fill(subject, varsFor(preview)) : ''
  const pBody = preview ? fill(body, varsFor(preview)) : ''
  const broken = preview ? hasUnfilled(pSubject) || hasUnfilled(pBody) : false
  const sentCount = data ? Object.keys(data.sent).length : 0

  function toggle(t: CampaignTarget, email: string) {
    setPicked((p) => {
      const cur = p[t.id] || []
      return { ...p, [t.id]: cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email] }
    })
  }

  async function sendAll() {
    if (!data || !queue.length) return
    if (!confirm(`سيتم إرسال ${queue.length} إيميل — إيميل واحد لكل شركة، مع البروفايل.\nمتأكد؟`)) return
    await saveText(subject, body)
    let ok = 0
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i]
      setSending({ done: i, total: queue.length, current: t.company_ar })
      try {
        const r = await fetch('/api/campaigns/stone-2026/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: t.id, emails: picked[t.id] }) })
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.sent) {
          ok++
          setData((d) => (d ? { ...d, sent: { ...d.sent, [t.id]: j.sent }, failed: Object.fromEntries(Object.entries(d.failed).filter(([k]) => k !== t.id)) } : d))
        } else {
          setData((d) => (d ? { ...d, failed: { ...d.failed, [t.id]: { at: new Date().toISOString(), error: j.error || 'فشل' } } } : d))
          // The profile or the message is wrong — stop instead of failing 15 more times.
          if (/البروفايل|متغيّر/.test(j.error || '')) { toast.error(j.error); break }
        }
      } catch {
        setData((d) => (d ? { ...d, failed: { ...d.failed, [t.id]: { at: new Date().toISOString(), error: 'انقطع الاتصال' } } } : d))
      }
      await new Promise((res) => setTimeout(res, 1200)) // gentle on the mail server
    }
    setSending(null)
    toast.success(`تم إرسال ${ok} من ${queue.length}`)
  }

  if (!data) return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-5xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shadow-md"><Mail className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">حملة المشاريع</h1>
          <p className="text-sm text-muted-foreground">مهمة مؤقتة · {data.targets.length} شركة من ملف المشاريع (31 أكتوبر) · أُرسل لـ {sentCount}</p>
        </div>
      </div>

      {/* 1. profile */}
      <section className="rounded-2xl border bg-card p-4 mb-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2">١. البروفايل المرفق</p>
        {data.profile.ok ? (
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-red-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate"><bdi>{data.profile.name || 'Company-Profile.pdf'}</bdi></p>
              <p className="text-xs text-muted-foreground">ينرفق مع كل إيميل — تأكد إنه بروفايل أبراج العاصمة</p>
            </div>
            <a href={data.profile.url || '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium hover:bg-muted"><ExternalLink className="w-4 h-4" />فتح</a>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-red-600 font-medium"><TriangleAlert className="w-4 h-4" />البروفايل غير مرفوع أو ما يفتح — ارفعه من الإعدادات ← التواصل. الإرسال موقوف لين يتصلّح.</p>
        )}
      </section>

      {/* 2. message */}
      <section className="rounded-2xl border bg-card p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-muted-foreground flex-1">٢. الرسالة (تقدر تعدّلها — تنحفظ تلقائياً)</p>
          <span className="text-[11px] text-muted-foreground">{saved === 'saving' ? 'يحفظ…' : saved === 'saved' ? 'محفوظ ✓' : saved === 'error' ? 'لم يُحفظ' : ''}</span>
          <button type="button" onClick={() => { setSubject(DEFAULT_SUBJECT); setBody(DEFAULT_BODY); saveText(DEFAULT_SUBJECT, DEFAULT_BODY) }} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><RotateCcw className="w-3 h-3" />النص الأصلي</button>
        </div>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => saveText(subject, body)} dir="auto" className="w-full h-10 rounded-lg border bg-background px-3 text-sm font-semibold mb-2" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => saveText(subject, body)} dir="auto" rows={14} className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed" />
        <p className="text-[11px] text-muted-foreground mt-1">المتغيّرات تتعبّى لكل شركة: <bdi>{'{{company}} {{company_ar}} {{project}} {{project_ar}}'}</bdi></p>
      </section>

      {/* preview */}
      {preview && (
        <section className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-500/30 bg-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-emerald-600" />
            <p className="text-xs font-semibold flex-1">معاينة الإيميل النهائي لـ</p>
            <select value={previewId} onChange={(e) => setPreviewId(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
              {data.targets.map((t) => <option key={t.id} value={t.id}>{t.company_ar}</option>)}
            </select>
          </div>
          {broken && <p className="text-xs text-red-600 mb-2">في الرسالة متغيّر غير معروف بين {'{{ }}'} — الإرسال بيرفضه.</p>}
          <p className="text-sm font-bold mb-2" dir="auto">{pSubject}</p>
          <pre dir="auto" className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/30 rounded-lg p-3 max-h-96 overflow-y-auto">{pBody}</pre>
          <p className="text-[11px] text-muted-foreground mt-2">📎 <bdi>{data.profile.name || '—'}</bdi></p>
        </section>
      )}

      {/* 3. companies */}
      <section className="rounded-2xl border bg-card overflow-hidden">
        <p className="text-xs font-semibold text-muted-foreground px-4 pt-4 pb-2">٣. الشركات — إيميل واحد لكل شركة للإيميلات المعلّمة</p>
        <ul className="divide-y">
          {data.targets.map((t) => {
            const s = data.sent[t.id]
            const f = data.failed[t.id]
            return (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{t.company_ar} <span className="text-xs text-muted-foreground font-normal">· <bdi>{t.company_en}</bdi></span></p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.project_ar} · ملف {t.files.join(' و ')}</p>
                  </div>
                  {s ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5" />أُرسل {s.at ? day(s.at) : ''}</span>
                  ) : f ? (
                    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" title={f.error}>فشل</span>
                  ) : null}
                  <button type="button" onClick={() => { setPreviewId(t.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">معاينة</button>
                  <button type="button" onClick={() => sendTest(t)} disabled={!!testing || !!sending || !data.profile.ok} className="text-[11px] text-blue-600 hover:underline whitespace-nowrap disabled:opacity-40">
                    {testing === t.id ? 'يرسل…' : 'نسخة لبريدنا'}
                  </button>
                </div>
                <div className="mt-2 flex flex-col gap-1.5">
                  {t.emails.map((e) => {
                    const on = (picked[t.id] || []).includes(e.email)
                    return (
                      <label key={e.email} className={`flex items-start gap-2 text-sm ${s ? 'opacity-60' : 'cursor-pointer'}`}>
                        <input type="checkbox" disabled={!!s || !!sending} checked={s ? s.to.includes(e.email) : on} onChange={() => toggle(t, e.email)} className="mt-1 w-4 h-4 accent-emerald-600" />
                        <span className="min-w-0">
                          <span className="font-mono text-[13px]" dir="ltr">{e.email}</span>
                          <span className="text-xs text-muted-foreground"> · {e.label}</span>
                          {e.note && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{e.note}</span>}
                        </span>
                      </label>
                    )
                  })}
                  {f && !s && <p className="text-[11px] text-red-600">{f.error}</p>}
                  {s && (
                    // Proof: what the mail server answered, and whether a copy is in «Sent».
                    <p className="text-[11px] text-muted-foreground">
                      {s.response
                        ? <>✓ قبله خادم البريد {s.savedToSent ? '· 📁 محفوظ في المرسل' : '· لم يُحفظ في المرسل'}{s.rejected?.length ? <span className="text-red-600"> · رفض: <bdi>{s.rejected.join('، ')}</bdi></span> : null}</>
                        : <>أُرسل قبل تحديث الحفظ في «المرسل» — قبله الخادم بدون خطأ، لكن ما فيه نسخة في صندوق المرسل</>}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* send bar */}
      <div className="fixed bottom-0 inset-x-0 md:start-auto md:end-0 z-30 pointer-events-none">
        <div className="max-w-5xl mx-auto p-4 pointer-events-auto">
          <div className="rounded-2xl border bg-card/95 backdrop-blur shadow-xl p-3 flex items-center gap-3">
            <p className="flex-1 text-sm">
              {sending ? <>يرسل لـ <b>{sending.current}</b> ({sending.done + 1}/{sending.total})…</> : queue.length ? <>جاهز: <b>{queue.length}</b> شركة</> : sentCount ? 'تم الإرسال للكل ✓' : 'اختر الإيميلات'}
            </p>
            <button
              type="button" onClick={sendAll} disabled={!!sending || !queue.length || !data.profile.ok}
              className="h-11 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-2 disabled:opacity-40 transition active:scale-[0.98]"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}إرسال
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
