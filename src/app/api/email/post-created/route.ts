import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { tplNewPost } from '@/lib/email/templates'

// POST /api/email/post-created  Body: { postId: string }
// Fired right after the client successfully inserts a community post.
// We re-fetch the post (server-side, with admin key so we can read author
// + every recipient email even if RLS would otherwise filter) and broadcast
// to all active employees except the author.
//
// The email send happens inside `Promise.all` but we return early so the
// caller's UI doesn't wait on SMTP. If a send fails it's logged but doesn't
// block the response.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId } = await request.json().catch(() => ({}))
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: post } = await admin
    .from('posts')
    .select('id, content, user_id, profiles:user_id(full_name, email)')
    .eq('id', postId)
    .single() as { data: { id: string; content: string | null; user_id: string; profiles: { full_name: string | null; email: string } | null } | null }

  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Only the author of the post is allowed to trigger this — prevents
  // anyone from spamming the team by replaying post IDs.
  if (post.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: recipients } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .neq('id', post.user_id)

  const authorName = post.profiles?.full_name || post.profiles?.email?.split('@')[0] || 'عضو غسل'
  const preview = (post.content || '').trim() || '(وسائط مرفقة)'

  // Fire-and-forget: don't block the response on SMTP. The transport pool
  // limits concurrency so this won't blow up Gmail's rate limit.
  ;(async () => {
    for (const r of recipients ?? []) {
      if (!r.email) continue
      const tpl = tplNewPost({ recipientName: r.full_name ?? undefined, authorName, preview })
      await sendEmail({ to: r.email, subject: tpl.subject, html: tpl.html })
    }
  })()

  return NextResponse.json({ ok: true, recipients: recipients?.length ?? 0 })
}
