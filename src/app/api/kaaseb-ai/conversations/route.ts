// GET /api/kaaseb-ai/conversations — the signed-in user's saved conversations.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/kaaseb-ai/store'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ conversations: await listConversations(user.id) }, { headers: { 'Cache-Control': 'no-store' } })
}
