// GET  /api/manual-quotes/[id]/history — who changed this quote, what and when
// POST /api/manual-quotes/[id]/history — { entryId }: restore the quote to how
//      it was before that change (itself recorded as a restore).

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { quoteAccess } from '@/lib/manual-quotes/access'
import { getHistory } from '@/lib/manual-quotes/history'
import { restoreManualQuote } from '@/lib/manual-quotes/store'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await quoteAccess()
  if ('error' in a) return a.error
  const { id } = await params
  // Snapshots stay on the server — the list only needs who/when/what.
  const entries = (await getHistory(id)).map((e) => ({ id: e.id, at: e.at, lastAt: e.lastAt, by: e.by, byName: e.byName, source: e.source, changes: e.changes }))
  return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const a = await quoteAccess()
  if ('error' in a) return a.error
  const { id } = await params
  let body: { entryId?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (typeof body.entryId !== 'string') return NextResponse.json({ error: 'entryId مطلوب' }, { status: 400 })
  const quote = await restoreManualQuote(id, body.entryId, a.actor)
  if (!quote) return NextResponse.json({ error: 'النسخة غير موجودة' }, { status: 404 })
  return NextResponse.json({ quote })
}
