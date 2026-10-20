'use client'

// كاسب AI — the conversation surface (floating panel or the full /ai page).
// No canned prompts: a greeting by name, a composer, and saved conversations.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Copy, History, Loader2, Maximize2, Plus, Sparkles, Trash2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AiMessage, ConversationMeta } from '@/lib/kaaseb-ai/store'
import { AiMessageBody } from './AiMessageBody'
import { UNLOCK_ENDPOINT, type UnlockTarget } from '@/lib/kaaseb-ai/cards'

// A PIN typed in the composer: one token of plain ASCII (never an Arabic sentence).
const PIN_LIKE = /^[!-~]{4,64}$/

interface Props {
  mode: 'panel' | 'page'
  firstName: string
  onClose?: () => void
}

type Pending = { id: string; status: string }

export function KaasebAiMark({ className = 'w-4 h-4' }: { className?: string }) {
  return <Sparkles className={className} />
}

export function KaasebAiChat({ mode, firstName, onClose }: Props) {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const tx = (a: string, e: string) => (ar ? a : e)
  const Back = isRtl ? ChevronRight : ChevronLeft

  const [convs, setConvs] = useState<ConversationMeta[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [loadingConv, setLoadingConv] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [opened, setOpened] = useState<UnlockTarget[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const abort = useRef<AbortController | null>(null)

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/kaaseb-ai/conversations')
      const j = await r.json().catch(() => ({}))
      if (r.ok && Array.isArray(j.conversations)) setConvs(j.conversations)
    } catch { /* offline — the list just stays as is */ }
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  async function openConversation(id: string) {
    setShowHistory(false)
    if (id === convId) return
    abort.current?.abort()
    setPending(null)
    setConvId(id)
    setMessages([])
    setLoadingConv(true)
    try {
      const r = await fetch(`/api/kaaseb-ai/conversations/${id}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error)
      setMessages(Array.isArray(j.messages) ? j.messages : [])
    } catch {
      toast.error(tx('تعذّر فتح المحادثة', 'Could not open the conversation'))
    } finally { setLoadingConv(false) }
  }

  function newChat() {
    abort.current?.abort()
    setPending(null)
    setConvId(null)
    setMessages([])
    setShowHistory(false)
    setTimeout(() => box.current?.focus(), 0)
  }

  async function removeConversation(id: string) {
    if (!confirm(tx('حذف هذه المحادثة؟', 'Delete this conversation?'))) return
    const prev = convs
    setConvs((l) => l.filter((c) => c.id !== id))
    if (id === convId) newChat()
    const r = await fetch(`/api/kaaseb-ai/conversations/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!r?.ok) { setConvs(prev); toast.error(tx('تعذّر الحذف', 'Delete failed')) }
  }

  // The section the latest reply asked a PIN for (if still locked).
  const lastBot = [...messages].reverse().find((m) => m.role === 'assistant')
  const lockedTarget = (lastBot?.cards || []).map((c) => (c.type === 'unlock' ? c.target : null)).find((t): t is UnlockTarget => !!t && !opened.includes(t)) || null

  /** PIN → that section's own unlock endpoint (rate-limited there). Never sent
   *  to the model, never stored. On success the question that hit the lock is
   *  asked again. */
  async function unlock(target: UnlockTarget, pin: string): Promise<string | null> {
    try {
      const r = await fetch(UNLOCK_ENDPOINT[target], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return j.error || tx('تعذّر الفتح', 'Unlock failed')
    } catch { return tx('تعذّر الاتصال', 'Connection failed') }
    setOpened((o) => [...o, target])
    const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content
    if (lastQuestion) setTimeout(() => send(lastQuestion), 0)
    return null
  }

  /** The user's own decision on a proposal → the server applies (or not) and
   *  answers with the follow-up message (the updated quote card). */
  async function act(actionId: string, decision: 'confirm' | 'cancel'): Promise<string | null> {
    try {
      const r = await fetch(`/api/kaaseb-ai/actions/${actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return j.error || tx('تعذّر التنفيذ', 'Failed')
      if (j.message) setMessages((m) => [...m, j.message as AiMessage])
      return j.status === 'failed' ? (j.message?.content || tx('لم يُنفّذ', 'Not applied')) : null
    } catch { return tx('تعذّر الاتصال', 'Connection failed') }
  }

  async function send(again?: string) {
    const text = (again ?? input).trim()
    if (!text || pending) return
    if (again === undefined) setInput('')
    // Typed the PIN in the message box: unlock instead of chatting.
    if (again === undefined && lockedTarget && PIN_LIKE.test(text)) {
      const err = await unlock(lockedTarget, text)
      if (err) toast.error(err)
      return
    }
    const local: AiMessage = { id: `local-${Date.now()}`, role: 'user', content: text, at: new Date().toISOString() }
    setMessages((m) => [...m, local])
    setPending({ id: local.id, status: tx('يقرأ سؤالك…', 'Reading your question…') })

    const ctrl = new AbortController()
    abort.current = ctrl
    let activeConv = convId
    try {
      const res = await fetch('/api/kaaseb-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, message: text }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || tx('تعذّر الرد', 'No reply'))
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const ev = JSON.parse(line) as
            | { t: 'conv'; conversation: ConversationMeta }
            | { t: 'status'; text: string }
            | { t: 'done'; message: AiMessage }
            | { t: 'error'; message: AiMessage }
          if (ev.t === 'conv') {
            activeConv = ev.conversation.id
            setConvId(ev.conversation.id)
            setConvs((l) => [ev.conversation, ...l.filter((c) => c.id !== ev.conversation.id)])
          } else if (ev.t === 'status') {
            setPending((p) => (p ? { ...p, status: ev.text } : p))
          } else {
            setMessages((m) => [...m, ev.message])
          }
        }
      }
      if (activeConv) setConvs((l) => l.map((c) => (c.id === activeConv ? { ...c, updatedAt: new Date().toISOString() } : c)))
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setMessages((m) => [...m, {
        id: `err-${Date.now()}`, role: 'assistant', error: true, at: new Date().toISOString(),
        content: e instanceof Error && e.message ? e.message : tx('صار خلل في الاتصال، جرّب مرة ثانية.', 'Connection problem — try again.'),
      }])
    } finally {
      setPending(null)
      abort.current = null
    }
  }

  const empty = messages.length === 0 && !pending && !loadingConv
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(ar ? 'ar-SA-u-nu-latn' : 'en-GB', { month: 'short', day: 'numeric' })
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 border-b bg-card flex-shrink-0 pt-[env(safe-area-inset-top)] min-h-14">
        {showHistory ? (
          <button onClick={() => setShowHistory(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground" aria-label={tx('رجوع', 'Back')}>
            <Back className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-700 text-white flex items-center justify-center shadow-sm">
            <KaasebAiMark />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">{showHistory ? tx('المحادثات', 'Conversations') : tx('كاسب AI', 'Kaaseb AI')}</p>
          {!showHistory && <p className="text-[11px] text-muted-foreground leading-tight truncate">{tx('مساعدك داخل عالم كاسب', 'Your assistant inside Kaaseb World')}</p>}
        </div>
        {!showHistory && (
          <>
            <button onClick={() => setShowHistory(true)} className="p-2.5 sm:p-2 rounded-xl hover:bg-muted active:bg-muted text-muted-foreground" title={tx('المحادثات', 'Conversations')} aria-label={tx('المحادثات', 'Conversations')}>
              <History className="w-4 h-4" />
            </button>
            <button onClick={newChat} className="p-2.5 sm:p-2 rounded-xl hover:bg-muted active:bg-muted text-muted-foreground" title={tx('محادثة جديدة', 'New chat')} aria-label={tx('محادثة جديدة', 'New chat')}>
              <Plus className="w-4 h-4" />
            </button>
          </>
        )}
        {mode === 'panel' && (
          <>
            <Link href="/ai" onClick={onClose} className="hidden sm:inline-flex p-2 rounded-xl hover:bg-muted text-muted-foreground" title={tx('ملء الشاشة', 'Full screen')} aria-label={tx('ملء الشاشة', 'Full screen')}>
              <Maximize2 className="w-4 h-4" />
            </Link>
            <button onClick={onClose} className="p-2.5 sm:p-2 rounded-xl hover:bg-muted active:bg-muted text-muted-foreground" aria-label={tx('إغلاق', 'Close')}>
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto min-h-0">
          {convs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">{tx('ما فيه محادثات محفوظة', 'No saved conversations')}</p>
          ) : (
            <ul className="divide-y">
              {convs.map((c) => (
                <li key={c.id} className={`group flex items-center gap-2 px-3 hover:bg-muted/40 ${c.id === convId ? 'bg-muted/50' : ''}`}>
                  <button onClick={() => openConversation(c.id)} className="flex-1 min-w-0 text-start py-3">
                    <span className="block text-sm font-medium truncate">{c.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{fmt(c.updatedAt)}</span>
                  </button>
                  <button onClick={() => removeConversation(c.id)} className="p-1.5 rounded-md text-muted-foreground/60 hover:text-red-600 hover:bg-red-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition" aria-label={tx('حذف', 'Delete')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div ref={scroller} className="flex-1 overflow-y-auto min-h-0 px-3 py-4">
            <div className={`${mode === 'page' ? 'max-w-3xl' : ''} mx-auto space-y-4`}>
              {empty && (
                <div className="flex flex-col items-center text-center pt-10 sm:pt-16 px-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-700 text-white flex items-center justify-center shadow-lg shadow-indigo-900/20">
                    <KaasebAiMark className="w-6 h-6" />
                  </div>
                  <p className="mt-4 text-lg font-bold">{tx(`هلا ${firstName}`, `Hello ${firstName}`)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{tx('وش تحتاج اليوم؟', 'What do you need today?')}</p>
                </div>
              )}
              {loadingConv && <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-3.5 py-2 text-sm whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-2">
                    {/* Phones: the cards get the full width — the avatar shows from sm up. */}
                    <div className="hidden sm:flex w-7 h-7 rounded-lg bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-700 text-white items-center justify-center flex-shrink-0 mt-0.5">
                      <KaasebAiMark className="w-3.5 h-3.5" />
                    </div>
                    <div className={`min-w-0 flex-1 ${m.error ? 'text-red-600' : ''}`}>
                      <AiMessageBody content={m.content} cards={m.cards} isRtl={isRtl} unlock={unlock} opened={opened} act={act} />
                      {!m.error && m.content.trim() && <CopyButton text={m.content} label={tx('نسخ', 'Copy')} done={tx('تم النسخ', 'Copied')} />}
                    </div>
                  </div>
                ),
              )}
              {pending && (
                <div className="flex gap-2 items-center">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-900 via-indigo-900 to-sky-700 text-white flex items-center justify-center flex-shrink-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <p className="text-xs text-muted-foreground">{pending.status}</p>
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t bg-card p-2.5 flex-shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            <div className={`${mode === 'page' ? 'max-w-3xl' : ''} mx-auto flex items-end gap-2 rounded-2xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-400 transition`}>
              <textarea
                ref={box}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 4000))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
                }}
                rows={1}
                autoFocus={mode === 'page'}
                placeholder={lockedTarget ? tx('اكتب الرمز السري أو رسالتك…', 'Type the PIN or your message…') : tx('اكتب رسالتك…', 'Type your message…')}
                // While a section waits for its PIN, a PIN-looking entry shows as dots.
                style={lockedTarget && PIN_LIKE.test(input) ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties) : undefined}
                autoComplete="off"
                className="flex-1 resize-none bg-transparent outline-none text-base sm:text-sm leading-6 max-h-40 py-1"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || !!pending}
                className="w-10 h-10 sm:w-9 sm:h-9 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center disabled:opacity-30 transition hover:scale-105 active:scale-95 flex-shrink-0"
                aria-label={tx('إرسال', 'Send')}
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Copy the reply's words (card markers and markdown stars removed). */
function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        const plain = text.replace(/\[\[card:[\w-]+\]\]/g, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim()
        try { await navigator.clipboard.writeText(plain); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* clipboard blocked */ }
      }}
      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{ok ? done : label}
    </button>
  )
}
