// Changing a manual quote from the chat — always as a PROPOSAL the user
// confirms with «تأكيد» (see ../actions.ts for the security model), plus the
// quote's history, which is shown only when asked for.

import { listManualQuotes, getManualQuote, previewPatch, type ManualQuote, type ManualQuoteItem } from '@/lib/manual-quotes/store'
import { diffQuotes, getHistory } from '@/lib/manual-quotes/history'
import { createAction } from '../actions'
import type { Tone } from '../cards'
import { type AiTool, type ToolCtx, str, int } from '../tool'

async function findQuote(args: Record<string, unknown>): Promise<ManualQuote | null> {
  const id = str(args.id, 80)
  const num = int(args.number, 0, 0, 10_000_000)
  if (id) return getManualQuote(id)
  if (num) return (await listManualQuotes()).find((x) => x.number === num) || null
  return null
}

const ITEM_PROPS = {
  description: { type: 'string' }, details: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' },
  unit_price: { type: ['number', 'null'] }, notes: { type: 'string', description: 'Shows on the quote.' },
  admin_notes: { type: 'string', description: 'Management only.' },
} as const

const QUOTE_PROPS = {
  subject: { type: 'string' }, project_name: { type: 'string' }, company: { type: 'string' }, client_name: { type: 'string' },
  email: { type: 'string' }, phone: { type: 'string' }, currency: { type: 'string', enum: ['SAR', 'USD'] },
  language: { type: 'string', enum: ['ar', 'en'] }, vat_rate: { type: 'number', description: '0.15 or 0' },
  delivery: { type: 'string', enum: ['none', 'included', 'excluded'] }, shipping: { type: 'number' }, notes: { type: 'string' },
} as const

type ItemArgs = Partial<Record<keyof typeof ITEM_PROPS, unknown>>
function applyItemArgs(it: ManualQuoteItem, a: ItemArgs): ManualQuoteItem {
  const next = { ...it }
  if (typeof a.description === 'string') next.description = a.description
  if (typeof a.details === 'string') next.details = a.details
  if (a.quantity !== undefined && Number.isFinite(Number(a.quantity))) next.quantity = Number(a.quantity)
  if (typeof a.unit === 'string') next.unit = a.unit
  if (a.unit_price === null) next.unit_price = null
  else if (a.unit_price !== undefined && Number.isFinite(Number(a.unit_price))) next.unit_price = Number(a.unit_price)
  if (typeof a.notes === 'string') next.notes = a.notes
  if (typeof a.admin_notes === 'string') next.adminNotes = a.admin_notes
  return next
}

const propose = (ctx: ToolCtx, title: string, subtitle: string, lines: ReturnType<typeof diffQuotes>, actionId: string) =>
  ctx.card({ type: 'confirm', actionId, title, subtitle, lines: lines.slice(0, 40), status: 'pending' })

const editQuote: AiTool = {
  name: 'manual_quote_edit',
  description: 'PROPOSE changes to a manual quote: quote fields (client, subject, VAT, delivery, currency, language…), edit lines by their 1-based number n, add lines, remove lines. Nothing is saved — the user sees a before→after card and must press «تأكيد». Use whenever the user asks to change / add / remove / reprice something in a quote.',
  parameters: {
    type: 'object',
    properties: {
      number: { type: 'integer', description: 'Quote number.' },
      id: { type: 'string' },
      quote: { type: 'object', properties: QUOTE_PROPS, description: 'Quote-level fields to change.' },
      set_items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, ...ITEM_PROPS }, required: ['n'] }, description: 'Edit existing lines (n = line number as shown in manual_quote_get).' },
      add_items: { type: 'array', items: { type: 'object', properties: { after_n: { type: 'integer', description: 'Insert after this line; omit = at the end.' }, ...ITEM_PROPS }, required: ['description'] } },
      remove_items: { type: 'array', items: { type: 'integer' }, description: 'Line numbers to delete.' },
    },
  },
  perms: ['page.furn'],
  status: 'يجهّز التعديل للمراجعة…',
  async run(args, ctx) {
    const q = await findQuote(args)
    if (!q) return { error: 'حدد رقم العرض.' }
    let items = q.items.slice()
    const bad: number[] = []
    // Edits and removals refer to the CURRENT numbering — apply edits first, removals last.
    for (const raw of Array.isArray(args.set_items) ? args.set_items.slice(0, 200) : []) {
      const a = raw as ItemArgs & { n?: unknown }
      const n = int(a.n, 0, 0, 100000)
      if (!n || n > q.items.length) { bad.push(n); continue }
      const id = q.items[n - 1].id
      items = items.map((it) => (it.id === id ? applyItemArgs(it, a) : it))
    }
    const adds = (Array.isArray(args.add_items) ? args.add_items.slice(0, 200) : []) as Array<ItemArgs & { after_n?: unknown }>
    for (const a of adds.slice().reverse()) {
      const blank: ManualQuoteItem = { id: '', description: '', details: '', quantity: 1, unit: 'm²', unit_price: null, imageUrl: null, notes: '', adminNotes: '' }
      const it = applyItemArgs(blank, a)
      const after = int(a.after_n, 0, 0, 100000)
      const anchor = after && after <= q.items.length ? q.items[after - 1].id : null
      const idx = anchor ? items.findIndex((x) => x.id === anchor) + 1 : items.length
      items.splice(idx, 0, it)
    }
    const removeIds = new Set((Array.isArray(args.remove_items) ? args.remove_items : [])
      .map((n) => int(n, 0, 0, 100000)).filter((n) => { if (!n || n > q.items.length) { bad.push(n); return false } return true })
      .map((n) => q.items[n - 1].id))
    items = items.filter((it) => !removeIds.has(it.id))

    const patch: Partial<ManualQuote> = { items }
    const qa = (args.quote && typeof args.quote === 'object' ? args.quote : {}) as Record<string, unknown>
    for (const k of Object.keys(QUOTE_PROPS) as Array<keyof typeof QUOTE_PROPS>) {
      if (qa[k] !== undefined) (patch as Record<string, unknown>)[k] = qa[k]
    }
    const preview = previewPatch(q, patch)
    const lines = diffQuotes(q, preview)
    if (bad.length) return { error: `أرقام بنود غير موجودة: ${bad.join('، ')}. العرض فيه ${q.items.length} بند.` }
    if (!lines.length) return { error: 'ما فيه تغيير فعلي — القيم المطلوبة هي نفسها الحالية.' }

    const action = await createAction({
      kind: 'quote_edit', userId: ctx.user.id, conversationId: ctx.conversationId,
      quoteId: q.id, quoteNumber: q.number, baseUpdatedAt: q.updatedAt, patch,
    })
    const ref = propose(ctx, `تعديل عرض #${q.number}`, q.subject || q.project_name || q.company || '', lines, action.id)
    return { card: ref, proposed_changes: lines.length, note: 'لم يُحفظ شيء بعد — اطلب منه يراجع البطاقة ويضغط «تأكيد».' }
  },
}

const history: AiTool = {
  name: 'manual_quote_history',
  description: 'The change history of a manual quote: who changed what and when (from the page or the chat), newest first, each with an id usable by manual_quote_restore. ONLY when the user explicitly asks for the history / who edited.',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, id: { type: 'string' }, limit: { type: 'integer', description: '1-30, default 10.' } } },
  perms: ['page.furn'],
  status: 'يقرأ سجل التعديلات…',
  async run(args, ctx) {
    const q = await findQuote(args)
    if (!q) return { error: 'حدد رقم العرض.' }
    const entries = await getHistory(q.id)
    const limit = int(args.limit, 10, 1, 30)
    const SRC: Record<string, { label: string; tone: Tone }> = { editor: { label: 'من الصفحة', tone: 'slate' }, chat: { label: 'من كاسب AI', tone: 'violet' }, restore: { label: 'استرجاع', tone: 'amber' } }
    const ref = entries.length
      ? ctx.card({
          type: 'list', title: `سجل تعديلات عرض #${q.number}`, total: entries.length,
          rows: entries.slice(0, limit).map((e) => ({
            title: `${e.byName || '—'} · ${new Date(e.lastAt).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })}`,
            subtitle: e.changes.slice(0, 3).map((c) => `${c.item ? `${c.item}: ` : ''}${c.label}${c.after !== undefined ? ` ← ${c.after}` : ''}`).join(' · ') + (e.changes.length > 3 ? ` (+${e.changes.length - 3})` : ''),
            badge: SRC[e.source],
          })),
        })
      : null
    return {
      card: ref, count: entries.length,
      entries: entries.slice(0, limit).map((e) => ({ id: e.id, by: e.byName, at: e.lastAt, source: e.source, changes: e.changes.slice(0, 20) })),
      note: entries.length ? undefined : 'ما فيه تعديلات مسجّلة على هذا العرض (السجل بدأ مع هذا التحديث).',
    }
  },
}

const restore: AiTool = {
  name: 'manual_quote_restore',
  description: 'PROPOSE putting a manual quote back to how it was BEFORE a history entry (id from manual_quote_history). Shows what would change; the user must press «تأكيد».',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, id: { type: 'string' }, entry_id: { type: 'string' } }, required: ['entry_id'] },
  perms: ['page.furn'],
  status: 'يجهّز الاسترجاع للمراجعة…',
  async run(args, ctx) {
    const q = await findQuote(args)
    if (!q) return { error: 'حدد رقم العرض.' }
    const entry = (await getHistory(q.id)).find((e) => e.id === str(args.entry_id, 40))
    if (!entry) return { error: 'ما لقيت هذي النسخة في السجل.' }
    const lines = diffQuotes(q, previewPatch(q, entry.snapshot))
    if (!lines.length) return { error: 'العرض الحالي مطابق لتلك النسخة.' }
    const action = await createAction({
      kind: 'quote_restore', userId: ctx.user.id, conversationId: ctx.conversationId,
      quoteId: q.id, quoteNumber: q.number, baseUpdatedAt: q.updatedAt, entryId: entry.id,
    })
    const when = new Date(entry.at).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })
    const ref = propose(ctx, `استرجاع عرض #${q.number}`, `إلى ما قبل تعديل ${entry.byName || ''} (${when})`, lines, action.id)
    return { card: ref, proposed_changes: lines.length, note: 'لم يُحفظ شيء بعد — يراجع البطاقة ويضغط «تأكيد».' }
  },
}

export const EDIT_TOOLS: AiTool[] = [editQuote, history, restore]
