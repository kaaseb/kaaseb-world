// POST /api/inbox/[id]/translate  { target?: 'ar'|'en' } → { text }
// Translates the (hydrated) email body to Arabic (default) or English via the
// configured AI provider. Used by the reader's "ترجمة" toggle.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getEmail } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { getProvider } from '@/lib/ai'
import { friendlyAiError } from '@/lib/ai/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 60

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation'],
  properties: { translation: { type: 'string', description: 'The full translated text, only.' } },
} as const

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.inbox')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!(await inboxUnlocked())) return NextResponse.json({ error: 'مقفل', locked: true }, { status: 423 })

  const { id } = await params
  const email = await getEmail(id)
  if (!email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const text = (email.bodyText || '').trim()
  if (!text) return NextResponse.json({ error: 'جهّز الرسالة أولاً ثم ترجم.' }, { status: 400 })

  let body: { target?: unknown }
  try { body = await request.json() } catch { body = {} }
  const target = body?.target === 'en' ? 'en' : 'ar'
  const targetName = target === 'ar' ? 'العربية' : 'الإنجليزية'

  try {
    const provider = await getProvider()
    const parsed = await provider.generateStructured<{ translation: string }>({
      systemInstruction: `أنت مترجم محترف. ترجم النص التالي ترجمة دقيقة وطبيعية إلى ${targetName}. حافظ على الأرقام والمقاسات والمصطلحات الفنية وأسماء الشركات كما هي. أعِد الترجمة فقط بلا أي شرح أو مقدمة.`,
      files: [],
      userText: text.slice(0, 12000),
      schema: SCHEMA,
      schemaName: 'email_translation',
      temperature: 0.2,
    })
    return NextResponse.json({ text: String(parsed.translation || '') })
  } catch (e) {
    return NextResponse.json({ error: friendlyAiError(e instanceof Error ? e.message : String(e)) }, { status: 502 })
  }
}
