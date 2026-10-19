// GET    /api/kaaseb-ai/conversations/[id] — one of MY conversations
// DELETE /api/kaaseb-ai/conversations/[id] — delete it
// The user id always comes from the session, so nobody reaches another's chats.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getConversation, deleteConversation, isConversationId } from '@/lib/kaaseb-ai/store'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isConversationId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const messages = await getConversation(user.id, id)
  if (!messages) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifyOrigin(request)
  if (csrf) return csrf
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isConversationId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await deleteConversation(user.id, id)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
