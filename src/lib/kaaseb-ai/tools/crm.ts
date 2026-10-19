// Client projects, the email inbox, opportunities and target companies.

import { getProjectEmail } from '@/lib/projects/email'
import { getInboxState } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { getState as getOpportunities } from '@/lib/opportunities/store'
import { getCompaniesState } from '@/lib/companies/store'
import { isAppOwnedUrl } from '@/lib/s3'
import { action, compact, day, type Tone } from '../cards'
import { type AiTool, str, int, bool, matches, inRange, date, toEnd, likeSafe, DATE_ARGS } from '../tool'
import { fileAction } from './quotes'

export const CP_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'جديد', tone: 'blue' },
  in_progress: { label: 'جاري العمل عليه', tone: 'amber' },
  ready_to_send: { label: 'جاهز للإرسال', tone: 'violet' },
  awaiting_reply: { label: 'بانتظار الرد', tone: 'amber' },
  updates_requested: { label: 'طالبين تحديثات', tone: 'red' },
  rejected: { label: 'مرفوض', tone: 'red' },
  completed: { label: 'مكتمل', tone: 'emerald' },
}
export const CP_STAGE: Record<string, string> = {
  plans_intake: 'استلام المخططات والرفع', quantity_takeoff: 'حصر الكميات', receive_quotes: 'استلام العروض السعرية',
  pricing: 'التسعير', submit_offer: 'تقديم العرض للعميل', negotiation: 'التفاوض والترسية',
  materials_approval: 'اعتماد المواد والعينات', shop_drawings: 'الرفع التنفيذي والتفصيل', manufacturing: 'التصنيع والقص',
  site_delivery: 'التوريد للموقع', installation_qc: 'التركيب والجودة والاستلام', handover_close: 'التسليم النهائي والإغلاق',
}
const FILE_CAT: Record<string, string> = { boq: 'BOQ', spec: 'مواصفات', drawing: 'رسومات', other: 'أخرى' }

const cpName = (p: { name_ar?: string | null; name_en?: string | null }) => p.name_ar || p.name_en || '—'
const cpCompany = (p: { company_ar?: string | null; company_en?: string | null }) => p.company_ar || p.company_en || ''

// ── client projects ──────────────────────────────────────────────────────────
const projectsList: AiTool = {
  name: 'client_projects_list',
  description: 'Search / list CLIENT projects (المشاريع — the sales pipeline): by text (name, company, engineer, number), status, stage, responsible person, date range, or overdue (end date passed and not completed).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      status: { type: 'string', enum: Object.keys(CP_STATUS) },
      stage: { type: 'string', enum: Object.keys(CP_STAGE) },
      responsible: { type: 'string', description: 'Name of the responsible employee.' },
      overdue: { type: 'boolean' },
      ...DATE_ARGS,
      limit: { type: 'integer', description: '1-25, default 8.' },
    },
  },
  perms: ['page.client_projects'],
  status: 'يبحث في المشاريع…',
  async run(args, ctx) {
    const q = likeSafe(str(args.query))
    const limit = int(args.limit, 8, 1, 25)
    let query = ctx.supabase
      .from('client_projects')
      .select('id, project_number, name_ar, name_en, company_ar, company_en, engineer_name_ar, engineer_name_en, status, stage, end_date, created_at, responsible_user:profiles!client_projects_responsible_user_id_fkey(full_name)')
      .order('created_at', { ascending: false })
    if (q) {
      const n = Number(q.replace(/^#/, ''))
      query = Number.isInteger(n) && n > 0
        ? query.eq('project_number', n)
        : query.or(`name_en.ilike.%${q}%,name_ar.ilike.%${q}%,company_en.ilike.%${q}%,company_ar.ilike.%${q}%,engineer_name_en.ilike.%${q}%,engineer_name_ar.ilike.%${q}%`)
    }
    if (str(args.status)) query = query.eq('status', str(args.status))
    if (str(args.stage)) query = query.eq('stage', str(args.stage))
    if (date(args.from)) query = query.gte('created_at', date(args.from))
    if (toEnd(args.to)) query = query.lte('created_at', toEnd(args.to))
    if (bool(args.overdue)) query = query.lt('end_date', new Date().toISOString().slice(0, 10)).neq('status', 'completed')
    const { data, error } = await query.limit(500)
    if (error) return { error: error.message }
    const who = str(args.responsible)
    interface Row {
      id: string; project_number: number; name_ar: string | null; name_en: string | null
      company_ar: string | null; company_en: string | null; status: string; stage: string
      end_date: string | null; created_at: string; responsible_user: unknown
    }
    const resp = (p: Row) => {
      const r = p.responsible_user as { full_name?: string | null } | Array<{ full_name?: string | null }> | null
      return (Array.isArray(r) ? r[0]?.full_name : r?.full_name) || ''
    }
    const all = ((data || []) as unknown as Row[]).filter((p) => !who || matches(who, resp(p)))
    const rows = all.slice(0, limit)
    const ref = rows.length
      ? ctx.card({
          type: 'list',
          title: 'المشاريع',
          total: all.length,
          rows: rows.map((p) => ({
            title: `#${p.project_number} · ${cpName(p)}`,
            subtitle: [cpCompany(p), CP_STAGE[p.stage] || p.stage, resp(p)].filter(Boolean).join(' · '),
            badge: CP_STATUS[p.status],
            href: `/projects/${p.id}`,
          })),
          more: all.length > limit ? { label: 'كل المشاريع', href: '/projects' } : undefined,
        })
      : null
    return {
      card: ref, count: all.length,
      projects: rows.map((p) => ({
        id: p.id, number: p.project_number, name: cpName(p), company: cpCompany(p), status: p.status, stage: p.stage,
        end_date: p.end_date, responsible: resp(p), created: String(p.created_at).slice(0, 10),
      })),
    }
  },
}

const projectGet: AiTool = {
  name: 'client_project_get',
  description: 'Open ONE client project by number or id: client, engineer, phone, email, status, stage, end date, responsible person, notes and every uploaded file (with download links).',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, id: { type: 'string' } } },
  perms: ['page.client_projects'],
  status: 'يفتح المشروع…',
  async run(args, ctx) {
    const id = str(args.id, 80)
    const num = int(args.number, 0, 0, 10_000_000)
    if (!id && !num) return { error: 'حدد رقم المشروع.' }
    let query = ctx.supabase.from('client_projects').select('*, responsible_user:profiles!client_projects_responsible_user_id_fkey(full_name)')
    query = id ? query.eq('id', id) : query.eq('project_number', num)
    const { data: p } = await query.maybeSingle()
    if (!p) return { error: 'ما لقيت مشروع بهذا الرقم.' }
    const email = await getProjectEmail(p.id).catch(() => '')
    const files = (Array.isArray(p.files) ? p.files : []) as Array<{ url: string; name: string; category?: string }>
    const resp = (Array.isArray(p.responsible_user) ? p.responsible_user[0] : p.responsible_user)?.full_name || ''
    const late = p.end_date && p.status !== 'completed' && p.end_date < new Date().toISOString().slice(0, 10)
    const ref = ctx.card({
      type: 'record',
      kind: `مشروع #${p.project_number}`,
      title: cpName(p),
      subtitle: [cpCompany(p), p.engineer_name_ar || p.engineer_name_en].filter(Boolean).join(' · ') || undefined,
      badge: CP_STATUS[p.status],
      fields: compact([
        { label: 'المرحلة', value: CP_STAGE[p.stage] || p.stage },
        p.end_date ? { label: 'تاريخ التسليم', value: `${day(p.end_date)}${late ? ' (متأخر)' : ''}` } : null,
        resp ? { label: 'المسؤول', value: resp } : null,
        p.engineer_phone ? { label: 'الجوال', value: p.engineer_phone } : null,
        email ? { label: 'الإيميل', value: email } : null,
        { label: 'الملفات', value: String(files.length) },
      ]),
      actions: compact([action('open', 'فتح المشروع', `/projects/${p.id}`)]),
    })
    const filesRef = files.length
      ? ctx.card({
          type: 'list',
          title: `ملفات المشروع #${p.project_number}`,
          total: files.length,
          rows: files.slice(0, 20).map((f) => ({ title: f.name, subtitle: FILE_CAT[f.category || 'other'], href: isAppOwnedUrl(f.url) ? f.url : undefined })),
        })
      : null
    return {
      card: ref, files_card: filesRef,
      number: p.project_number, name: cpName(p), name_en: p.name_en, company: cpCompany(p),
      engineer: p.engineer_name_ar || p.engineer_name_en, phone: p.engineer_phone, email,
      status: p.status, stage: p.stage, end_date: p.end_date, overdue: !!late, responsible: resp,
      currency: p.pricing_currency, notes: p.notes ? String(p.notes).slice(0, 800) : null,
      files: files.map((f) => ({ name: f.name, category: f.category || 'other' })),
      created: p.created_at,
    }
  },
}

// ── inbox ────────────────────────────────────────────────────────────────────
const inbox: AiTool = {
  name: 'inbox_search',
  description: 'Search the company email inbox (صندوق الوارد): by text (subject, sender, body), unread only, status (new / converted / archived), date range. Returns the AI summary of each email and its attachments.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      unread: { type: 'boolean' },
      status: { type: 'string', enum: ['new', 'converted', 'archived'] },
      ...DATE_ARGS,
      limit: { type: 'integer', description: '1-15, default 6.' },
    },
  },
  perms: ['page.inbox'],
  status: 'يبحث في صندوق الوارد…',
  async run(args, ctx) {
    // The inbox has its own PIN on top of the permission — the assistant must
    // not become a way around it.
    if (!(await inboxUnlocked())) return { locked: true, message: 'صندوق الوارد مقفل برمز. افتحه من صفحة الوارد أولاً ثم اسأل.' }
    const q = str(args.query)
    const from = date(args.from)
    const to = toEnd(args.to)
    const limit = int(args.limit, 6, 1, 15)
    const status = str(args.status)
    const unread = bool(args.unread)
    const { items } = await getInboxState()
    const hits = items
      .filter((e) => inRange(e.date, from, to))
      .filter((e) => !status || e.status === status)
      .filter((e) => unread === undefined || e.read === !unread)
      .filter((e) => !q || matches(q, e.subject, e.fromName, e.fromEmail, e.bodyText, e.preview?.projectName, e.preview?.summary))
      .sort((a, b) => b.date.localeCompare(a.date))
    const rows = hits.slice(0, limit)
    const ref = rows.length
      ? ctx.card({
          type: 'list',
          title: 'صندوق الوارد',
          total: hits.length,
          rows: rows.map((e) => ({
            title: e.subject || '(بدون عنوان)',
            subtitle: [e.fromName || e.fromEmail, day(e.date), e.attachmentCount ? `${e.attachmentCount} مرفق` : ''].filter(Boolean).join(' · '),
            badge: e.status === 'converted' ? { label: 'صار مشروع', tone: 'emerald' as Tone } : !e.read ? { label: 'غير مقروء', tone: 'blue' as Tone } : e.repliedAt ? { label: 'تم الرد', tone: 'slate' as Tone } : undefined,
            href: e.projectId ? `/projects/${e.projectId}` : '/inbox',
          })),
          more: { label: 'فتح صندوق الوارد', href: '/inbox' },
        })
      : null
    return {
      card: ref, count: hits.length, unread_total: items.filter((e) => !e.read).length,
      emails: rows.map((e) => ({
        subject: e.subject, from: e.fromName || e.fromEmail, from_email: e.fromEmail, date: e.date.slice(0, 16), status: e.status,
        read: e.read, replied: !!e.repliedAt, converted_project: !!e.projectId,
        summary: e.preview?.summary?.slice(0, 400) || e.bodyText?.slice(0, 300) || '',
        project_name: e.preview?.projectName || null,
        requirements: e.preview?.requirements?.slice(0, 8) || [],
        attachments: e.attachments.slice(0, 12).map((a) => a.name),
        attachment_count: e.attachmentCount,
      })),
      // Attachments as a downloadable list for the first email only (keeps it focused).
      attachments_card: rows[0]?.attachments?.length
        ? ctx.card({
            type: 'list',
            title: `مرفقات: ${rows[0].subject || ''}`.slice(0, 80),
            total: rows[0].attachments.length,
            rows: rows[0].attachments.slice(0, 15).map((a) => ({ title: a.name, subtitle: a.category || undefined, href: fileAction('', a.url)?.href })),
          })
        : null,
    }
  },
}

// ── opportunities + companies ────────────────────────────────────────────────
const OPP_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'جديدة', tone: 'blue' }, saved: { label: 'محفوظة', tone: 'violet' },
  contacted: { label: 'تم التواصل', tone: 'emerald' }, archived: { label: 'مؤرشفة', tone: 'slate' },
}
const opportunities: AiTool = {
  name: 'opportunities_search',
  description: 'Search market opportunities (الفرص — projects found on the web): by text, city, status (new / saved / contacted / archived), minimum score. Returns owner, stage, contacts, why relevant.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' }, status: { type: 'string', enum: Object.keys(OPP_STATUS) },
      min_score: { type: 'integer' }, limit: { type: 'integer', description: '1-20, default 8.' },
    },
  },
  perms: ['page.opportunities'],
  status: 'يبحث في الفرص…',
  async run(args, ctx) {
    const q = str(args.query)
    const status = str(args.status)
    const min = int(args.min_score, 0, 0, 100)
    const limit = int(args.limit, 8, 1, 20)
    const { items } = await getOpportunities()
    const hits = items.filter((o) => (!status || o.status === status) && (o.score ?? 0) >= min && (!q || matches(q, o.title, o.summary, o.city, o.owner, o.category, o.stage)))
    const rows = hits.slice(0, limit)
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'الفرص', total: hits.length,
          rows: rows.map((o) => ({ title: o.title, subtitle: [o.owner, o.city, o.stage].filter(Boolean).join(' · '), meta: o.score != null ? `${o.score}` : undefined, badge: OPP_STATUS[o.status], href: '/opportunities' })),
          more: { label: 'كل الفرص', href: '/opportunities' },
        })
      : null
    return {
      card: ref, count: hits.length,
      opportunities: rows.map((o) => ({
        title: o.title, owner: o.owner, city: o.city, stage: o.stage, category: o.category, score: o.score, status: o.status,
        summary: o.summary?.slice(0, 300), relevance: o.relevance?.slice(0, 200),
        contacts: (o.contacts || []).slice(0, 4).map((c) => ({ name: c.name, role: c.role, email: c.email, phone: c.phone })),
      })),
    }
  },
}

const COMPANY_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'جديدة', tone: 'blue' }, saved: { label: 'محفوظة', tone: 'violet' }, contacted: { label: 'تم التواصل', tone: 'amber' },
  client: { label: 'عميل', tone: 'emerald' }, archived: { label: 'مؤرشفة', tone: 'slate' },
}
const companies: AiTool = {
  name: 'target_companies_search',
  description: 'Search target companies (الشركات المستهدفة): by text, city, category, status (new / saved / contacted / client / archived). Returns contacts and why each matters.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, status: { type: 'string', enum: Object.keys(COMPANY_STATUS) }, limit: { type: 'integer', description: '1-20, default 8.' } },
  },
  perms: ['page.companies'],
  status: 'يبحث في الشركات المستهدفة…',
  async run(args, ctx) {
    const q = str(args.query)
    const status = str(args.status)
    const limit = int(args.limit, 8, 1, 20)
    const { items } = await getCompaniesState()
    const hits = items.filter((c) => (!status || c.status === status) && (!q || matches(q, c.name, c.city, c.category, c.summary, c.projects)))
    const rows = hits.slice(0, limit)
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'الشركات المستهدفة', total: hits.length,
          rows: rows.map((c) => ({ title: c.name, subtitle: [c.category, c.city].filter(Boolean).join(' · '), meta: c.score != null ? `${c.score}` : undefined, badge: COMPANY_STATUS[c.status], href: '/companies' })),
          more: { label: 'كل الشركات', href: '/companies' },
        })
      : null
    return {
      card: ref, count: hits.length,
      companies: rows.map((c) => ({
        name: c.name, category: c.category, city: c.city, size: c.size, score: c.score, status: c.status,
        summary: c.summary?.slice(0, 300), why: c.whyRelevant?.slice(0, 200),
        contacts: (c.contacts || []).slice(0, 4).map((k) => ({ name: k.name, role: k.role, email: k.email, phone: k.phone, website: k.website })),
      })),
    }
  },
}

export const CRM_TOOLS: AiTool[] = [projectsList, projectGet, inbox, opportunities, companies]
