// Server-side audit logger.
//
// The `src/lib/audit.ts` helper that ships with the project posts to
// `/api/audit` from the browser. That's fine for client-rendered actions,
// but server-side route handlers (the API surface for Projects, Tannoor,
// Important Documents, Pre-qualifications, …) can write directly without
// the round-trip. This is the helper they use.
//
// Failures are swallowed: a successful business action shouldn't fail just
// because the audit row couldn't be written.

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type Action = 'add' | 'edit' | 'delete'

export async function serverAudit(params: {
  user: Pick<User, 'id' | 'email'> | null
  supabase: SupabaseClient
  action: Action
  objectType: string          // e.g. 'client_project', 'tannoor_product'
  objectName?: string | null  // human-readable label for the audit log
  objectId?: string | null    // UUID, stored as text in audit_logs
}): Promise<void> {
  try {
    const { user, action, objectType, objectName, objectId } = params

    // Resolve the user's display name once; the audit_logs row stores it
    // denormalized so the audit page doesn't have to JOIN profiles on every
    // render (and so deleted users still show up correctly in history).
    let userName: string | null = null
    if (user?.id) {
      const { data: profile } = await params.supabase
        .from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      userName = profile?.full_name ?? null
    }

    // Use the admin client so the insert bypasses RLS — the policy on
    // audit_logs is permissive in our schema but going through admin keeps
    // future tightening one-step away.
    const admin = createAdminClient()
    await admin.from('audit_logs').insert({
      user_id:    user?.id || null,
      user_name:  userName,
      user_email: user?.email || null,
      action_type: action,
      object_type: objectType,
      object_name: objectName || null,
      object_id:   objectId   || null,
    })
  } catch {
    // Silent — we don't want a logging failure to break the user's action.
  }
}
