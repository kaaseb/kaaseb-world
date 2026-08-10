// Ensure a project has its chat conversation (create-once, idempotent). Shared by
// the lazy open-time route AND project creation (so a new project's chat opens
// automatically). Best-effort: returns the conversation id, or null on failure —
// project creation must never fail because chat setup did.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getProjectConversationId, setProjectConversationId } from './store'

export async function ensureProjectConversation(
  supabase: SupabaseClient,
  project: { id: string; name_ar?: string | null; name_en?: string | null },
  userId: string,
): Promise<string | null> {
  const existing = await getProjectConversationId(project.id)
  if (existing) {
    const { data: conv } = await supabase.from('chat_conversations').select('id').eq('id', existing).maybeSingle()
    if (conv) return existing
  }
  const name = (project.name_ar || project.name_en || 'مشروع').slice(0, 200)
  const { data: created, error } = await supabase
    .from('chat_conversations')
    .insert({ type: 'group', name: `💼 ${name}`, description: 'دردشة المشروع', created_by: userId })
    .select('id').single()
  if (error || !created) return null
  await setProjectConversationId(project.id, created.id)
  return created.id
}
