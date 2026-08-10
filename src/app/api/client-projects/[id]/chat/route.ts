// POST /api/client-projects/[id]/chat — ensure this project has a chat
// conversation and return its id. Reuses the existing chat_conversations table;
// the project→conversation link lives in S3 (no new DB column). The messaging
// itself happens client-side against chat_messages (RLS is open to authenticated,
// so any team member with project access can read/write) with Supabase realtime.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getProjectConversationId, setProjectConversationId } from '@/lib/project-chats/store'
import { getProjectChatEnabled } from '@/lib/project-chats/settings'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.client_projects')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await getProjectChatEnabled())) {
    return NextResponse.json({ error: 'دردشة المشاريع مُعطّلة.' }, { status: 403 })
  }

  const { id } = await params
  const { data: project } = await supabase
    .from('client_projects').select('id, name_ar, name_en').eq('id', id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Already linked → verify the conversation row still exists, else recreate.
  const existing = await getProjectConversationId(id)
  if (existing) {
    const { data: conv } = await supabase
      .from('chat_conversations').select('id').eq('id', existing).maybeSingle()
    if (conv) return NextResponse.json({ conversationId: existing })
  }

  const name = (project.name_ar || project.name_en || 'مشروع').slice(0, 200)
  const { data: created, error } = await supabase
    .from('chat_conversations')
    .insert({ type: 'group', name: `💼 ${name}`, description: 'دردشة المشروع', created_by: user.id })
    .select('id')
    .single()
  if (error || !created) {
    return NextResponse.json({ error: error?.message || 'تعذّر إنشاء الدردشة' }, { status: 500 })
  }

  await setProjectConversationId(id, created.id)
  return NextResponse.json({ conversationId: created.id })
}
