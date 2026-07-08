// Arabic-first HTML email templates. Inline styles (no <style> block) so
// Gmail/Outlook don't strip them. Each template returns { subject, html }.
//
// Style choices:
// • RTL via dir="rtl" on the body wrapper so Arabic text aligns correctly
//   in clients that respect the attribute.
// • Single-column layout, max-width 560px — looks the same on phone & desktop.
// • Brand color (sky-800 #075985) matches the app's light-mode sidebar so
//   inbox previews feel consistent with the product.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://world.kaaseb.sa'
const BRAND = '#075985'
const BRAND_DARK = '#0c4a6e'

function shell(title: string, bodyInner: string, ctaHref?: string, ctaLabel?: string): string {
  const cta = ctaHref && ctaLabel ? `
    <tr><td align="center" style="padding:24px 0 8px">
      <a href="${ctaHref}" style="display:inline-block;padding:12px 28px;background:${BRAND};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
        ${ctaLabel}
      </a>
    </td></tr>` : ''

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body dir="rtl" style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Tajawal,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <tr><td style="background:${BRAND};padding:18px 24px">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.2px">عالم غسل</span>
        </td></tr>
        <tr><td style="padding:28px 24px 8px">
          <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND_DARK};font-weight:700">${escapeHtml(title)}</h1>
          <div style="font-size:14px;line-height:1.7;color:#374151">
            ${bodyInner}
          </div>
        </td></tr>
        ${cta}
        <tr><td style="padding:20px 24px 24px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;line-height:1.6">
          هذي رسالة آلية من نظام عالم غسل. لو لا تتوقع استلامها، تجاهلها بأمان.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ───────────────────────────────────────────────────────────────────────────
// Template builders. Each returns { subject, html } so the caller passes
// the result directly into sendEmail().
// ───────────────────────────────────────────────────────────────────────────

export function tplTest(recipientName?: string) {
  const greeting = recipientName ? `أهلاً ${escapeHtml(recipientName)}،` : 'أهلاً،'
  return {
    subject: 'اختبار نظام إيميلات غسل',
    html: shell(
      'النظام يعمل ✅',
      `<p>${greeting}</p>
       <p>إذا وصلتك هذه الرسالة فمعناه أن نظام إرسال الإيميلات في غسل تم إعداده وتشغيله بنجاح.</p>
       <p style="color:#6b7280;font-size:13px">المُرسل: <strong>${escapeHtml(process.env.SMTP_USER ?? '—')}</strong></p>
       <p style="color:#6b7280;font-size:13px">الوقت: ${new Date().toLocaleString('ar-SA')}</p>`,
      APP_URL, 'فتح لوحة التحكم',
    ),
  }
}

export function tplTaskAssigned(opts: {
  recipientName?: string
  taskTitle: string
  source: 'project' | 'goal' | 'department'
  containerName?: string | null
  href?: string | null
}) {
  const sourceLabel = opts.source === 'project' ? 'مشروع' : opts.source === 'goal' ? 'هدف' : 'قسم'
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  return {
    subject: `📋 مهمة جديدة: ${opts.taskTitle}`,
    html: shell(
      'تم تعيينك على مهمة جديدة',
      `<p>${greeting}</p>
       <p>تم تعيينك على المهمة التالية:</p>
       <div style="margin:16px 0;padding:14px;background:#f9fafb;border-right:3px solid ${BRAND};border-radius:6px">
         <p style="margin:0;font-weight:700;color:#111827;font-size:15px">${escapeHtml(opts.taskTitle)}</p>
         ${opts.containerName ? `<p style="margin:6px 0 0;color:#6b7280;font-size:12px">في ${sourceLabel}: <strong>${escapeHtml(opts.containerName)}</strong></p>` : ''}
       </div>
       <p>افتح المهمة لتشاهد التفاصيل وتحدّث الحالة.</p>`,
      opts.href ? `${APP_URL}${opts.href}` : APP_URL, 'فتح المهمة',
    ),
  }
}

export function tplNewPost(opts: {
  recipientName?: string
  authorName: string
  preview: string
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  const preview = opts.preview.length > 180 ? opts.preview.slice(0, 180) + '…' : opts.preview
  return {
    subject: `📝 منشور جديد من ${opts.authorName}`,
    html: shell(
      'منشور جديد في مجتمع غسل',
      `<p>${greeting}</p>
       <p><strong>${escapeHtml(opts.authorName)}</strong> نشر شيئاً جديداً:</p>
       <div style="margin:16px 0;padding:14px;background:#f9fafb;border-right:3px solid ${BRAND};border-radius:6px;color:#374151;font-size:14px;line-height:1.7">
         ${escapeHtml(preview)}
       </div>`,
      `${APP_URL}/dashboard`, 'افتح المنشور',
    ),
  }
}

export function tplNewStory(opts: { recipientName?: string; authorName: string }) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  return {
    subject: `🎬 ستوري جديد من ${opts.authorName}`,
    html: shell(
      'ستوري جديد',
      `<p>${greeting}</p>
       <p><strong>${escapeHtml(opts.authorName)}</strong> أضاف ستوري جديد. شاهده قبل ما يختفي.</p>`,
      `${APP_URL}/dashboard`, 'مشاهدة الستوري',
    ),
  }
}

export function tplNewDM(opts: {
  recipientName?: string
  senderName: string
  preview: string | null
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  const preview = opts.preview
    ? (opts.preview.length > 180 ? opts.preview.slice(0, 180) + '…' : opts.preview)
    : '(مرفق)'
  return {
    subject: `💬 رسالة جديدة من ${opts.senderName}`,
    html: shell(
      'رسالة خاصة جديدة',
      `<p>${greeting}</p>
       <p><strong>${escapeHtml(opts.senderName)}</strong> أرسل لك رسالة:</p>
       <div style="margin:16px 0;padding:14px;background:#f9fafb;border-right:3px solid ${BRAND};border-radius:6px;color:#374151;font-size:14px;line-height:1.7">
         ${escapeHtml(preview)}
       </div>`,
      `${APP_URL}/community`, 'فتح المحادثة',
    ),
  }
}

export function tplNotification(opts: {
  recipientName?: string
  title: string
  body?: string | null
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  return {
    subject: `🔔 ${opts.title}`,
    html: shell(
      opts.title,
      `<p>${greeting}</p>
       ${opts.body ? `<p style="color:#374151;font-size:14px;line-height:1.7">${escapeHtml(opts.body)}</p>` : ''}`,
      `${APP_URL}/notifications`, 'فتح التنبيهات',
    ),
  }
}

export function tplEventReminder(opts: {
  recipientName?: string
  eventTitle: string
  eventDate: string
  eventTime?: string | null
  locationType: 'online' | 'in_person'
  meetingUrl?: string | null
  location?: string | null
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  const where = opts.locationType === 'online'
    ? (opts.meetingUrl ? `عن بُعد — <a href="${opts.meetingUrl}" style="color:${BRAND}">رابط الاجتماع</a>` : 'عن بُعد')
    : (opts.location ? `حضوري في ${escapeHtml(opts.location)}` : 'حضوري')
  return {
    subject: `📅 تذكير: ${opts.eventTitle} غداً`,
    html: shell(
      `تذكير: ${opts.eventTitle}`,
      `<p>${greeting}</p>
       <p>عندك ايفنت غداً:</p>
       <div style="margin:16px 0;padding:14px;background:#f9fafb;border-right:3px solid ${BRAND};border-radius:6px">
         <p style="margin:0;font-weight:700;font-size:15px">${escapeHtml(opts.eventTitle)}</p>
         <p style="margin:6px 0 0;color:#6b7280;font-size:13px">${escapeHtml(opts.eventDate)}${opts.eventTime ? ` · ${escapeHtml(opts.eventTime.slice(0,5))}` : ''}</p>
         <p style="margin:6px 0 0;color:#6b7280;font-size:13px">${where}</p>
       </div>`,
      `${APP_URL}/calendar`, 'فتح التقويم',
    ),
  }
}

export function tplExpiredTasks(opts: {
  recipientName?: string
  tasks: { title: string }[]
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  const list = opts.tasks.map(t => `<li style="margin:4px 0">${escapeHtml(t.title)}</li>`).join('')
  return {
    subject: '⏰ مهام انتهى وقتها بدون إكمال',
    html: shell(
      'مهامك التي راحت',
      `<p>${greeting}</p>
       <p>المهام التالية انتهى وقتها قبل ما تعلّم عليها كمنتهية:</p>
       <ul style="margin:12px 0;padding-${'right' /* RTL */}:18px;color:#374151;font-size:14px;line-height:1.8">
         ${list}
       </ul>`,
      `${APP_URL}/daily-tasks`, 'فتح المهام اليومية',
    ),
  }
}

export function tplPointsThreshold(opts: {
  recipientName?: string
  totalPoints: number
}) {
  const greeting = opts.recipientName ? `أهلاً ${escapeHtml(opts.recipientName)}،` : 'أهلاً،'
  return {
    subject: '🎉 نقاطك تكفي لشراء جوائز من المتجر',
    html: shell(
      'وصلت لنقاط تخوّلك للشراء',
      `<p>${greeting}</p>
       <p>وصل رصيدك إلى <strong>${opts.totalPoints} نقطة</strong> — تكفي لشراء جوائز من المتجر.</p>`,
      `${APP_URL}/store`, 'فتح المتجر',
    ),
  }
}
