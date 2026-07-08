import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { tplNewStory } from '@/lib/email/templates'

// POST /api/email/story-created  Body: { storyId: string }
// Fired after a story is inserted. Same pattern as post-created — broadcast
// to all employees except the author.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { storyId } = await request.json().catch(() => ({}))
  if (!storyId) return NextResponse.json({ error: 'storyId required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: story } = await admin
    .from('stories')
    .select('id, user_id, profiles:user_id(full_name, email)')
    .eq('id', storyId)
    .single() as { data: { id: string; user_id: string; profiles: { full_name: string | null; email: string } | null } | null }

  if (!story) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (story.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: recipients } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .neq('id', story.user_id)

  const authorName = story.profiles?.full_name || story.profiles?.email?.split('@')[0] || 'عضو غسل'

  ;(async () => {
    for (const r of recipients ?? []) {
      if (!r.email) continue
      const tpl = tplNewStory({ recipientName: r.full_name ?? undefined, authorName })
      await sendEmail({ to: r.email, subject: tpl.subject, html: tpl.html })
    }
  })()

  return NextResponse.json({ ok: true, recipients: recipients?.length ?? 0 })
}
