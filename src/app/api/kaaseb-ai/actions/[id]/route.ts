// POST /api/kaaseb-ai/actions/[id] — { decision: 'confirm' | 'cancel' }
//
// The ONLY way a Kaaseb AI proposal changes anything: the signed-in user's own
// click. Checks, in order: CSRF, session, the action is this user's, still
// pending, not older than 30 minutes, the user may still edit quotes, and the
// quote was not changed by anyone since the proposal (else it would overwrite
// their work). Then it saves through the normal store — so the change lands in
// the quote's history as "من كاسب AI" with the user's name.

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { createClient } from '@/lib/supabase/server'
import { quoteAccess } from '@/lib/manual-quotes/access'
import { getManualQuote, updateManualQuote, restoreManualQuote } from '@/lib/manual-quotes/store'
import { getAction, settleAction, isActionId, ACTION_TTL_MS } from '@/lib/kaaseb-ai/actions'
import { appendMessages, setConfirmStatus, newId, type AiMessage } from '@/lib/kaaseb-ai/store'
import { quoteCard } from '@/lib/kaaseb-ai/tools/quotes'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isActionId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  let body: { decision?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const decision = body.decision === 'confirm' ? 'confirm' : body.decision === 'cancel' ? 'cancel' : null
  if (!decision) return NextResponse.json({ error: 'decision مطلوب' }, { status: 400 })

  // Stored under THIS user's folder — another user's id simply isn't found.
  const action = await getAction(user.id, id)
  if (!action || action.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (action.status !== 'pending') return NextResponse.json({ error: 'هذا الاقتراح تم التعامل معه من قبل.', status: action.status }, { status: 409 })

  const finish = async (status: 'done' | 'cancelled' | 'failed', text: string, extra?: Partial<AiMessage>) => {
    const msg: AiMessage = { id: newId(8), role: 'assistant', content: text, at: new Date().toISOString(), ...extra }
    await setConfirmStatus(user.id, action.conversationId, action.id, status, status === 'failed' ? text : undefined).catch(() => {})
    await appendMessages(user.id, action.conversationId, [msg]).catch(() => {})
    return NextResponse.json({ status, message: msg })
  }

  if (decision === 'cancel') {
    if (!(await settleAction(user.id, id, 'cancelled'))) return NextResponse.json({ error: 'تم التعامل معه من قبل.' }, { status: 409 })
    return finish('cancelled', `أُلغي — ما تغيّر شي في عرض #${action.quoteNumber}.`)
  }

  const access = await quoteAccess()
  if ('error' in access) return access.error // lost the permission since the proposal

  if (Date.now() - new Date(action.createdAt).getTime() > ACTION_TTL_MS) {
    await settleAction(user.id, id, 'failed')
    return finish('failed', 'انتهت صلاحية هذا الاقتراح (أكثر من 30 دقيقة). اطلب التعديل مرة ثانية.')
  }
  const current = await getManualQuote(action.quoteId)
  if (!current) {
    await settleAction(user.id, id, 'failed')
    return finish('failed', `عرض #${action.quoteNumber} غير موجود.`)
  }
  if (current.updatedAt !== action.baseUpdatedAt) {
    await settleAction(user.id, id, 'failed')
    return finish('failed', `عرض #${action.quoteNumber} تعدّل بعد الاقتراح — ما طبّقت شي عشان ما أكتب فوق شغل أحد. اطلب التعديل مرة ثانية.`)
  }
  // Claim it first: a double click / second tab can't apply it twice.
  if (!(await settleAction(user.id, id, 'done'))) return NextResponse.json({ error: 'تم التعامل معه من قبل.' }, { status: 409 })

  const updated = action.kind === 'quote_restore' && action.entryId
    ? await restoreManualQuote(action.quoteId, action.entryId, access.actor)
    : action.patch
      ? await updateManualQuote(action.quoteId, action.patch, { ...access.actor, source: 'chat' })
      : null
  if (!updated) {
    await setConfirmStatus(user.id, action.conversationId, action.id, 'failed').catch(() => {})
    return finish('failed', 'تعذّر الحفظ — ما تغيّر شي. جرّب مرة ثانية.')
  }
  const ref = `r${newId(4)}`
  const verb = action.kind === 'quote_restore' ? 'استرجعت' : 'عدّلت'
  return finish('done', `تم ✓ ${verb} عرض #${updated.number} — هذي النسخة المحدّثة:\n[[card:${ref}]]`, {
    cards: [{ ...quoteCard(updated), ref }],
  })
}
