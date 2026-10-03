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
import { fetchAppOwned, uploadBufferToS3 } from '@/lib/s3'
import { renderQuotationPdf } from '@/lib/quotation-pdf'
import { createAdminClient } from '@/lib/supabase/admin'
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
  if (!quotation) {
    return NextResponse.json({ error: 'لا يوجد عرض سعر بهذه اللغة — اضغط «إرسال (إنشاء العرض)» في تبويب التسعير أولاً.' }, { status: 400 })
  }
  // The stored PDF may be missing (its render failed when the quotation was
  // issued). Render it NOW rather than dead-ending — and if the server truly
  // cannot make PDFs, say exactly why so it can be fixed.
  let pdfBuffer: Buffer | null = null
  if (!quotation.pdf_url) {
    try {
      pdfBuffer = await renderQuotationPdf({
        origin: request.headers.get('origin') || new URL(request.url).origin,
        projectId: id,
        quotationId: quotation.id,
        cookieHeader: request.headers.get('cookie') || '',
      })
      const key = `furn/quotations/${id}/Kaaseb_${quotation.quotation_number}-${language}.pdf`
      const up = await uploadBufferToS3({ buffer: pdfBuffer, key, contentType: 'application/pdf' })
      await createAdminClient().from('furn_quotations').update({ pdf_url: up.url }).eq('id', quotation.id)
      quotation.pdf_url = up.url
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      return NextResponse.json({
        error: `تعذّر توليد ملف الـPDF على الخادم، لذلك لا يمكن إرفاقه بالإيميل. السبب: ${why.slice(0, 300)}${/libnspr|shared librar|Failed to launch|Could not find Chrome|ENOENT/i.test(why) ? ' — متصفح Chromium غير مثبت/مكتمل على الخادم (افتح /api/admin/health للتفاصيل).' : ''}`,
      }, { status: 502 })
    }
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
    let buf = pdfBuffer
    if (!buf) {
      const res = await fetchAppOwned(quotation.pdf_url)
      if (res.ok) buf = Buffer.from(await res.arrayBuffer())
    }
    if (buf && buf.byteLength > 0) {
      attachments.push({ filename: `Kaaseb_${quotation.quotation_number}-${language}.pdf`, content: buf })
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
    const why = e instanceof Error ? e.message : 'فشل'
    const hint = /auth|535|credentials|login/i.test(why) ? ' — بيانات حساب البريد غير صحيحة (الإعدادات ← البريد).'
      : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(why) ? ' — تعذّر الاتصال بخادم البريد.'
      : /not configured|missing|غير مهيأ/i.test(why) ? ' — حساب الإرسال غير مهيأ (الإعدادات ← البريد).' : ''
    return NextResponse.json({ error: `تعذّر إرسال الإيميل: ${why}${hint}` }, { status: 502 })
  }

  await serverAudit({
    user, supabase, action: 'edit', objectType: 'furn_quotation',
    objectName: `أُرسل العرض ${quotation.quotation_number} إلى ${to}`, objectId: quotation.id,
  })

  return NextResponse.json({ ok: true, to, language })
}
