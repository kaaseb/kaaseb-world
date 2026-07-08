import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { tplNewDM } from '@/lib/email/templates'

// POST /api/email/dm-sent  Body: { messageId: string }
// Fired right after the client sends a chat message. We notify every
// recipient (other DM/group members) by email. Sender is excluded.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messageId } = await request.json().catch(() => ({}))
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: msg } = await admin
    .from('chat_messages')
    .select('id, conversation_id, sender_id, content, sender:sender_id(full_name, email)')
    .eq('id', messageId)
    .single() as { data: { id: string; conversation_id: string; sender_id: string; content: string | null; sender: { full_name: string | null; email: string } | null } | null }

  if (!msg) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (msg.sender_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Pull all members of the conversation except the sender — for groups
  // this also notifies everyone else, which is consistent with how Slack/
  // WhatsApp behave.
  const { data: members } = await admin
    .from('chat_members')
    .select('user_id, profiles:user_id(email, full_name)')
    .eq('conversation_id', msg.conversation_id)
    .neq('user_id', msg.sender_id) as { data: { user_id: string; profiles: { email: string; full_name: string | null } | null }[] | null }

  const senderName = msg.sender?.full_name || msg.sender?.email?.split('@')[0] || 'عضو غسل'

  ;(async () => {
    for (const m of members ?? []) {
      const email = m.profiles?.email
      if (!email) continue
      const tpl = tplNewDM({
        recipientName: m.profiles?.full_name ?? undefined,
        senderName,
        preview: msg.content,
      })
      await sendEmail({ to: email, subject: tpl.subject, html: tpl.html })
    }
  })()

  return NextResponse.json({ ok: true, recipients: members?.length ?? 0 })
}
