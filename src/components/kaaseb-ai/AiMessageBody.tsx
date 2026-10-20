'use client'

// Renders one Kaaseb AI reply: light markdown (bold, headings, bullets) + the
// server-built cards, placed where the model pointed at them ([[card:ref]]).
// No HTML is ever injected — text goes through React as text.

import { Fragment, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Download, PencilLine, ArrowUpLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Lock, LockOpen, Loader2, Check, X } from 'lucide-react'
import { renderableHref, isAppPage, type AiCard, type CardAction, type Tone, type UnlockTarget } from '@/lib/kaaseb-ai/cards'

/** Posts a PIN to the section's own unlock endpoint; returns an error or null. */
export type UnlockFn = (target: UnlockTarget, pin: string) => Promise<string | null>
/** Confirm / cancel a proposal; returns an error or null. */
export type ActFn = (actionId: string, decision: 'confirm' | 'cancel') => Promise<string | null>

export const TONE: Record<Tone, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-300',
}
const STAT_ACCENT: Record<Tone, string> = {
  emerald: 'before:bg-emerald-500', amber: 'before:bg-amber-500', red: 'before:bg-red-500',
  blue: 'before:bg-blue-500', violet: 'before:bg-violet-500', slate: 'before:bg-slate-400',
}

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${TONE[tone]}`}>{label}</span>
}

function ActionButton({ a, isRtl }: { a: CardAction; isRtl: boolean }) {
  const [open, setOpen] = useState(false)
  const href = renderableHref(a.href)
  if (!href) return null
  const Icon = a.kind === 'download' ? Download : a.kind === 'edit' ? PencilLine : isRtl ? ArrowUpLeft : ArrowUpRight
  const cls =
    a.kind === 'download' ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20'
    : a.kind === 'edit' ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/20'
    : 'bg-muted hover:bg-muted/70 text-foreground ring-1 ring-inset ring-border'
  const body = <><Icon className="w-3.5 h-3.5" />{a.label}</>
  const base = `w-full inline-flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap h-10 sm:h-9 px-2 sm:px-3 rounded-xl text-[13px] sm:text-xs font-semibold transition-colors active:scale-[0.98] ${cls}`
  const options = (a.options || []).filter((o) => renderableHref(o.href))
  if (options.length > 1) {
    // Language (or any) choice: the button opens a small picker under itself.
    return (
      <div className="relative">
        <button type="button" onClick={() => setOpen((v) => !v)} className={base} aria-expanded={open}>
          {body}<ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-20 top-full mt-1 inset-x-0 rounded-xl border bg-card shadow-xl p-1 flex flex-col">
            {options.map((o) => (
              <a key={o.href} href={o.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                className="px-3 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-semibold text-center text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 whitespace-nowrap">
                {o.label}
              </a>
            ))}
          </div>
        )}
      </div>
    )
  }
  return <SmartLink href={href} newTab={a.external} className={base}>{body}</SmartLink>
}

/** App pages open in place; files, PDFs, downloads and other sites open in a
 *  new browser tab — never replacing the page the user is working on. */
function SmartLink({ href, newTab, className, children }: { href: string; newTab?: boolean; className: string; children: ReactNode }) {
  return newTab || !isAppPage(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
    : <Link href={href} className={className}>{children}</Link>
}

export function CardView({ card, isRtl, unlock, opened, act }: { card: AiCard; isRtl: boolean; unlock?: UnlockFn; opened?: UnlockTarget[]; act?: ActFn }) {
  if (card.type === 'unlock') return <UnlockCard card={card} unlock={unlock} opened={!!opened?.includes(card.target)} />
  if (card.type === 'confirm') return <ConfirmCard card={card} act={act} />
  const Chevron = isRtl ? ChevronLeft : ChevronRight
  if (card.type === 'stats') {
    return (
      <div className="rounded-xl border bg-card p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">{card.title}</p>
        <div className="grid grid-cols-2 gap-2">
          {card.stats.map((s, i) => (
            <div key={i} className={`relative rounded-lg bg-muted/50 px-3 py-2 overflow-hidden before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full ${STAT_ACCENT[s.tone || 'slate']}`}>
              <p className="text-[11px] text-muted-foreground truncate">{s.label}</p>
              <p className="text-base font-bold tabular-nums leading-tight mt-0.5" dir="ltr" style={{ textAlign: isRtl ? 'right' : 'left' }}>{s.value}</p>
              {s.hint && <p className="text-[10px] text-muted-foreground truncate mt-0.5"><bdi>{s.hint}</bdi></p>}
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (card.type === 'list') {
    return (
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <p className="text-xs font-semibold">{card.title}</p>
          {typeof card.total === 'number' && <span className="text-[11px] text-muted-foreground tabular-nums">{card.total}</span>}
        </div>
        <ul className="divide-y">
          {card.rows.map((r, i) => {
            const href = renderableHref(r.href)
            const download = !!(href && (r.download || !isAppPage(href)))
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug line-clamp-2 break-words"><bdi>{r.title}</bdi></span>
                  {r.subtitle && <span className="block text-[11px] text-muted-foreground truncate mt-0.5"><bdi>{r.subtitle}</bdi></span>}
                </span>
                {r.meta && <span className="text-xs font-semibold tabular-nums whitespace-nowrap" dir="ltr">{r.meta}</span>}
                {r.badge && <Badge {...r.badge} />}
                {href && !download && <Chevron className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />}
              </>
            )
            return (
              <li key={i}>
                {href && download ? (
                  // A file: an explicit blue button, not a hidden row link.
                  <div className="flex items-center gap-2 px-3 py-2">
                    {inner}
                    <a href={href} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-9 sm:h-7 px-3 sm:px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-[11px] font-semibold flex-shrink-0 transition-colors active:scale-[0.97]">
                      <Download className="w-3.5 h-3.5" />تحميل
                    </a>
                  </div>
                ) : href ? (
                  <SmartLink href={href} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors">{inner}</SmartLink>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
        {card.more && renderableHref(card.more.href) && (
          <SmartLink href={card.more.href} className="block text-center text-xs font-medium text-blue-600 hover:bg-muted/40 py-2 border-t">{card.more.label}</SmartLink>
        )}
      </div>
    )
  }
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-muted-foreground">{card.kind}</p>
          <p className="text-sm font-bold leading-snug mt-0.5 break-words"><bdi>{card.title}</bdi></p>
          {card.subtitle && <p className="text-xs text-muted-foreground mt-0.5 break-words"><bdi>{card.subtitle}</bdi></p>}
        </div>
        {card.badge && <Badge {...card.badge} />}
      </div>
      {card.amount && <p className="text-lg font-extrabold tabular-nums mt-2" dir="ltr" style={{ textAlign: isRtl ? 'right' : 'left' }}>{card.amount}</p>}
      {card.fields && card.fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 text-xs">
          {card.fields.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-muted-foreground text-[11px]">{f.label}</dt>
              <dd className="font-medium truncate" title={f.value}><bdi>{f.value}</bdi></dd>
            </div>
          ))}
        </dl>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-3">
          {card.actions.map((a, i, all) => (
            <div key={i} className={all.length % 2 === 1 && i === all.length - 1 ? 'col-span-2' : ''}>
              <ActionButton a={a} isRtl={isRtl} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── light markdown ───────────────────────────────────────────────────────────
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>,
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list
    out.push(L.ordered
      ? <ol key={out.length} className="list-decimal ps-5 space-y-0.5">{L.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ol>
      : <ul key={out.length} className="list-disc ps-5 space-y-0.5 marker:text-muted-foreground">{L.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const b = /^\s*[-•*]\s+(.*)$/.exec(line)
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (b || n) {
      const ordered = !!n
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((b || n)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    out.push(h
      ? <p key={out.length} className="font-bold mt-1">{inline(h[1])}</p>
      : <p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="space-y-1.5">{out}</div>
}

/** Text with inline card markers; cards the text didn't place go at the end. */
export function AiMessageBody({ content, cards = [], isRtl, unlock, opened, act }: { content: string; cards?: AiCard[]; isRtl: boolean; unlock?: UnlockFn; opened?: UnlockTarget[]; act?: ActFn }) {
  const byRef = new Map(cards.map((c) => [c.ref, c]))
  const used = new Set<string>()
  const parts = content.split(/\[\[card:([\w-]+)\]\]/g)
  const nodes: ReactNode[] = []
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      const c = byRef.get(p)
      if (c && !used.has(p)) { used.add(p); nodes.push(<CardView key={`c${i}`} card={c} isRtl={isRtl} unlock={unlock} opened={opened} act={act} />) }
    } else if (p.trim()) {
      nodes.push(<TextBlock key={`t${i}`} text={p.trim()} />)
    }
  })
  for (const c of cards) if (!used.has(c.ref)) nodes.push(<CardView key={`r${c.ref}`} card={c} isRtl={isRtl} unlock={unlock} opened={opened} act={act} />)
  return <div className="space-y-2.5 text-sm leading-relaxed">{nodes}</div>
}

/** PIN box for a locked section. The PIN goes to that section's unlock endpoint
 *  (rate-limited there) — it never reaches the model and is never saved. */
function UnlockCard({ card, unlock, opened }: { card: Extract<AiCard, { type: 'unlock' }>; unlock?: UnlockFn; opened: boolean }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  async function submit() {
    if (!unlock || !pin.trim() || busy) return
    setBusy(true); setError(null)
    const err = await unlock(card.target, pin.trim())
    setBusy(false); setPin('')
    if (err) setError(err); else setDone(true)
  }
  if (done || opened) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-3 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        <LockOpen className="w-4 h-4" />تم الفتح ✓
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-500/10 dark:border-amber-500/30 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="w-4 h-4 text-amber-600" />{card.title}</p>
      <p className="text-[11px] text-muted-foreground mt-1">اكتب الرمز هنا أو في خانة الرسالة. الرمز يروح للنظام مباشرة ولا ينحفظ في المحادثة.</p>
      <form className="flex gap-1.5 mt-2.5" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input
          type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.slice(0, 64))}
          placeholder="الرمز السري" dir="ltr"
          className="flex-1 min-w-0 h-10 sm:h-9 rounded-xl border bg-background px-3 text-base sm:text-sm outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400"
        />
        <button type="submit" disabled={!pin.trim() || busy}
          className="h-10 sm:h-9 px-4 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}فتح
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}

/** A proposed change: before → after per line, and the user's own decision. */
function ConfirmCard({ card, act }: { card: Extract<AiCard, { type: 'confirm' }>; act?: ActFn }) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [local, setLocal] = useState<'done' | 'cancelled' | null>(null)
  const status = local || card.status || 'pending'
  async function decide(d: 'confirm' | 'cancel') {
    if (!act || busy) return
    setBusy(d); setError(null)
    const err = await act(card.actionId, d)
    setBusy(null)
    if (err) setError(err); else setLocal(d === 'confirm' ? 'done' : 'cancelled')
  }
  const frame = status === 'done' ? 'border-emerald-200 dark:border-emerald-500/30'
    : status === 'cancelled' || status === 'failed' ? 'border-border opacity-80' : 'border-indigo-200 dark:border-indigo-500/40 ring-1 ring-indigo-500/10'
  return (
    <div className={`rounded-xl border bg-card overflow-hidden ${frame}`}>
      <div className="px-3 py-2.5 border-b bg-muted/30 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold"><bdi>{card.title}</bdi></p>
          {card.subtitle && <p className="text-[11px] text-muted-foreground truncate"><bdi>{card.subtitle}</bdi></p>}
        </div>
        <Badge
          label={status === 'done' ? 'تم التنفيذ' : status === 'cancelled' ? 'أُلغي' : status === 'failed' ? 'لم يُنفّذ' : 'بانتظار تأكيدك'}
          tone={status === 'done' ? 'emerald' : status === 'failed' ? 'red' : status === 'cancelled' ? 'slate' : 'violet'}
        />
      </div>
      <ul className="divide-y max-h-80 overflow-y-auto">
        {card.lines.map((l, i) => (
          <li key={i} className="px-3 py-2 text-xs">
            <p className="text-muted-foreground"><bdi>{l.item ? `${l.item} — ` : ''}{l.label}</bdi></p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {l.before !== undefined && <span className="rounded-md bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-1.5 py-0.5 line-through decoration-red-400/70"><bdi>{l.before}</bdi></span>}
              {l.before !== undefined && l.after !== undefined && <span className="text-muted-foreground">←</span>}
              {l.after !== undefined && <span className="rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 font-semibold"><bdi>{l.after}</bdi></span>}
            </p>
          </li>
        ))}
      </ul>
      {status === 'pending' && act && (
        <div className="grid grid-cols-2 gap-1.5 p-3 border-t">
          <button type="button" onClick={() => decide('confirm')} disabled={!!busy}
            className="h-10 sm:h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 active:scale-[0.98] transition">
            {busy === 'confirm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}تأكيد
          </button>
          <button type="button" onClick={() => decide('cancel')} disabled={!!busy}
            className="h-10 sm:h-9 rounded-xl bg-muted hover:bg-muted/70 ring-1 ring-inset ring-border text-[13px] sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 active:scale-[0.98] transition">
            {busy === 'cancel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}إلغاء
          </button>
        </div>
      )}
      {(error || card.note) && <p className="px-3 pb-2.5 text-xs text-red-600">{error || card.note}</p>}
    </div>
  )
}
