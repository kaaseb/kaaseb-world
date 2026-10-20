// GET / PATCH / DELETE a single manual quote.

import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'
import { quoteAccess } from '@/lib/manual-quotes/access'
import { getManualQuote, updateManualQuote, deleteManualQuote, type ManualQuote } from '@/lib/manual-quotes/store'

export const runtime = 'nodejs'

async function guard() {
  const a = await quoteAccess()
  return 'error' in a ? a.error : null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const err = await guard()
  if (err) return err
  const { id } = await params
  const quote = await getManualQuote(id)
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ quote })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const a = await quoteAccess()
  if ('error' in a) return a.error
  const { id } = await params
  let body: Partial<ManualQuote>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  // Every save lands in the quote's history (coalesced per person) — who changed what.
  const quote = await updateManualQuote(id, body, { ...a.actor, source: 'editor' })
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ quote })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const err = await guard()
  if (err) return err
  const { id } = await params
  const ok = await deleteManualQuote(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
