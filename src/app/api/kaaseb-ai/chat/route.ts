// POST /api/kaaseb-ai/chat — one message to كاسب AI.
// Body: { conversationId?: string, message: string }
// Response: NDJSON stream —
//   {t:'conv', conversation}  (only when a new conversation was created)
//   {t:'status', text}        (what it is doing: "يبحث في العروض…")
//   {t:'done'|'error', message}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { AiNotConfiguredError, type ChatTurn } from '@/lib/ai'
import { friendlyAiError } from '@/lib/ai/friendly-error'
import { runTurn } from '@/lib/kaaseb-ai/engine'
import {
  appendMessages, createConversation, getConversation, isConversationId, newId,
  type AiMessage, type ConversationMeta,
} from '@/lib/kaaseb-ai/store'

export const runtime = 'nodejs'
export const maxDuration = 120

// Per-user flood guard (per server instance): 15 messages / minute.
const hits = new Map<string, number[]>()
function limited(userId: string): boolean {
  const now = Date.now()
  const recent = (hits.get(userId) || []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(userId, recent)
  if (hits.size > 5000) hits.clear()
  return recent.length > 15
}

/** Past turns for the model: card markers become a short description, so a
 *  follow-up ("حمّله لي") still knows what was shown — without stale refs. */
function toHistory(msgs: AiMessage[]): ChatTurn[] {
  return msgs
    .filter((m) => !m.error && m.content.trim())
    .slice(-20)
    .map((m) => {
      let content = m.content.replace(/\[\[card:[\w-]+\]\]/g, '').trim()
      if (m.role === 'assistant' && m.cards?.length) {
        const shown = m.cards.map((c) => (c.type === 'record' ? `${c.kind}: ${c.title}` : c.title)).join('؛ ')
        content = `${content}\n(عُرضت بطاقات: ${shown})`.trim()
      }
      return { role: m.role, content: content.slice(0, 6000) }
    })
}

export async function POST(request: Request) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { conversationId?: unknown; message?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : ''
  if (!message) return NextResponse.json({ error: 'الرسالة فارغة' }, { status: 400 })
  if (limited(user.id)) return NextResponse.json({ error: 'رسائل كثيرة خلال دقيقة — انتظر شوي وأرسل.' }, { status: 429 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)

  let conv: ConversationMeta | null = null
  let past: AiMessage[] = []
  if (body.conversationId != null && body.conversationId !== '') {
    if (!isConversationId(body.conversationId)) return NextResponse.json({ error: 'Bad conversation' }, { status: 400 })
    const msgs = await getConversation(user.id, body.conversationId)
    if (!msgs) return NextResponse.json({ error: 'المحادثة غير موجودة' }, { status: 404 })
    past = msgs
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => { try { controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`)) } catch { /* client left */ } }
      const userMsg: AiMessage = { id: newId(8), role: 'user', content: message, at: new Date().toISOString() }
      let convId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : ''
      try {
        if (!convId) {
          conv = await createConversation(user.id, message)
          convId = conv.id
          send({ t: 'conv', conversation: conv })
        }
        const { text, cards } = await runTurn({
          supabase, user, profile, permissions,
          history: [...toHistory(past), { role: 'user', content: message }],
          conversationId: convId,
          onStatus: (s) => send({ t: 'status', text: s }),
        })
        const reply: AiMessage = {
          id: newId(8), role: 'assistant', at: new Date().toISOString(),
          content: text || (cards.length ? '' : 'ما قدرت أجهّز رد هالمرة — أعد صياغة طلبك لو تكرمت.'),
          ...(cards.length ? { cards } : {}),
        }
        await appendMessages(user.id, convId, [userMsg, reply])
        send({ t: 'done', message: reply })
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e)
        console.error('[كاسب AI] turn failed:', raw)
        const content = e instanceof AiNotConfiguredError
          ? 'الذكاء الاصطناعي غير مهيّأ — أضف المفتاح من الإعدادات ← الذكاء الاصطناعي.'
          : friendlyAiError(raw) !== raw
            ? `ما قدرت أرد الحين. ${friendlyAiError(raw).split('\n')[0]}`
            : 'صار خلل مؤقت وما قدرت أرد — جرّب مرة ثانية بعد لحظات.'
        const errMsg: AiMessage = { id: newId(8), role: 'assistant', content, at: new Date().toISOString(), error: true }
        if (convId) await appendMessages(user.id, convId, [userMsg, errMsg]).catch(() => {})
        send({ t: 'error', message: errMsg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
