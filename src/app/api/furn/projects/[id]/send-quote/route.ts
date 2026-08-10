// POST /api/furn/projects/[id]/send-quote — email the finished quotation PDF.
//
// Everything is already prepared elsewhere: `finalize` rendered the AR + EN PDFs
// to S3, the recipient email lives on the linked client project (auto-filled
// from the inbox or typed in), the subject is that project's keywords field, and
// the body is the permanent bilingual cover message. This route just stitches
// them and sends via the Titan account (lib/outreach/transport) — no new creds.
//
// Body: { language: 'ar'|'en', to?, subject? }  (to/subject override the defaults)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { serverAudit } from '@/lib/audit-server'
import { fetchAppOwned } from '@/lib/s3'
import { resolveMailer } from '@/lib/outreach/transport'
import { textToHtml, isEmail } from '@/lib/outreach/send'
import { getQuoteMessage } from '@/lib/furn/quote-message'
import { getProjectEmail } from '@/lib/projects/email'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('furn.quotation.export')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { language?: unknown; to?: unknown; subject?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const language: 'ar' | 'en' = body.language === 'en' ? 'en' : 'ar'

  const { data: project } = await supabase.from('furn_projects').select('*').eq('id', id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // The quotation PDF for this language (rendered by finalize into S3).
  const { data: quotation } = await supabase
    .from('furn_quotations')
    .select('*')
    .eq('project_id', id).eq('language', language)
    .order('quotation_number', { ascending: false })
    .limit(1).maybeSingle()
  if (!quotation?.pdf_url) {
    return NextResponse.json({ error: 'ما فيه PDF لهذا العرض — أنشئ/أصدر العرض السعري أولاً.' }, { status: 400 })
  }

  // Recipient + subject come from the linked client project (email in S3, the
  // subject from its keywords field), overridable per send.
  let email = ''
  let subject = ''
  const clientId = project.source_client_project_id as string | null
  if (clientId) {
    email = await getProjectEmail(clientId)
    const { data: cp } = await supabase.from('client_projects').select('keywords').eq('id', clientId).maybeSingle()
    subject = (cp?.keywords || '').trim()
  }
  const to = (typeof body.to === 'string' && body.to.trim()) || email
  if (!isEmail(to)) {
    return NextResponse.json({ error: 'ما فيه بريد صالح للعميل — أضف الإيميل في المشروع أو أدخله هنا.' }, { status: 400 })
  }
  const finalSubject =
    (typeof body.subject === 'string' && body.subject.trim()) ||
    subject ||
    `${language === 'ar' ? 'عرض سعر رقم' : 'Quotation No.'} ${quotation.quotation_number}`

  // Attach the stored PDF.
  const attachments: Array<{ filename: string; content: Buffer }> = []
  try {
    const res = await fetchAppOwned(quotation.pdf_url)
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > 0) {
        attachments.push({ filename: `Quotation-${quotation.quotation_number}-${language}.pdf`, content: buf })
      }
    }
  } catch { /* fall through — surfaced below */ }
  if (attachments.length === 0) {
    return NextResponse.json({ error: 'تعذّر إرفاق ملف العرض.' }, { status: 502 })
  }

  const msg = await getQuoteMessage()
  const text = language === 'ar' ? msg.ar : msg.en

  try {
    const mailer = await resolveMailer()
    await mailer.transport.sendMail({
      from: mailer.from,
      to: to.trim(),
      replyTo: profile.email || mailer.replyToDefault || undefined,
      subject: finalSubject.slice(0, 300),
      text,
      html: textToHtml(text),
      attachments,
    })
  } catch (e) {
    return NextResponse.json({ error: `تعذّر الإرسال: ${e instanceof Error ? e.message : 'فشل'}` }, { status: 502 })
  }

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'furn_quotation',
    objectName: `أُرسل العرض ${quotation.quotation_number} إلى ${to}`, objectId: quotation.id,
  })

  return NextResponse.json({ ok: true, to, language })
}
