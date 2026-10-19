// Quotation tools: manual quotes (S3), Furn (Supabase + S3), Tannoor.

import { listManualQuotes, getManualQuote, type ManualQuote } from '@/lib/manual-quotes/store'
import { computeTotals } from '@/lib/quotation/totals'
import { isAppOwnedUrl } from '@/lib/s3'
import { action, compact, money, day, type Tone } from '../cards'
import { type AiTool, str, int, matches, inRange, date, toEnd, likeSafe, DATE_ARGS } from '../tool'

// ── shared ───────────────────────────────────────────────────────────────────
export function quoteTotals(q: ManualQuote) {
  const shipping = q.delivery === 'excluded' ? Math.max(0, Number(q.shipping) || 0) : 0
  return computeTotals(q.items || [], shipping, q.vat_rate || 0)
}

/** A stored S3 file → a download action only if it really is OUR bucket. */
export function fileAction(label: string, url: string | null | undefined) {
  if (!url || !isAppOwnedUrl(url)) return null
  return { kind: 'download' as const, label, href: url, external: true }
}

export const FURN_STAGE: Record<string, { label: string; tone: Tone }> = {
  processing: { label: 'قيد المعالجة', tone: 'amber' },
  pricing: { label: 'قيد التسعير', tone: 'blue' },
  quoted: { label: 'تم التسعير', tone: 'emerald' },
}
export const FURN_STATUS: Record<string, string> = {
  pending: 'قيد الانتظار', in_progress: 'قيد التنفيذ', completed: 'مكتمل', rejected: 'مرفوض', archived: 'مؤرشف',
}

function quoteTitle(q: ManualQuote) {
  return q.subject || q.project_name || q.company || q.client_name || 'بدون عنوان'
}

// ── manual quotes ────────────────────────────────────────────────────────────
const manualList: AiTool = {
  name: 'manual_quotes_list',
  description: 'Search / list MANUAL quotations (العروض اليدوية / عروض السعر اليدوية). Filter by free text (client, company, project, subject, item description, quote number, creator name) and date range. Returns totals so you can answer "how many / how much". Use manual_quote_get for one quote\'s full detail.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text: client, company, project, subject, item text, creator, or a number like 105.' },
      ...DATE_ARGS,
      limit: { type: 'integer', description: 'Rows to show (1-25). Default 8.' },
    },
  },
  perms: ['page.furn'],
  status: 'يبحث في العروض اليدوية…',
  async run(args, ctx) {
    const q = str(args.query)
    const from = date(args.from)
    const to = toEnd(args.to)
    const limit = int(args.limit, 8, 1, 25)
    const all = await listManualQuotes()
    const hits = all.filter((x) =>
      inRange(x.createdAt, from, to) &&
      (!q || String(x.number) === q.replace(/^#/, '') || matches(q, x.subject, x.project_name, x.company, x.client_name, x.createdByName, x.email, x.items?.map((i) => i.description).join(' '))),
    )
    const rows = hits.map((x) => ({ x, t: quoteTotals(x) }))
    const sum = (cur: string) => rows.filter((r) => r.x.currency === cur).reduce((n, r) => n + r.t.total, 0)
    const shown = rows.slice(0, limit)
    const ref = shown.length
      ? ctx.card({
          type: 'list',
          title: 'العروض اليدوية',
          total: hits.length,
          rows: shown.map(({ x, t }) => ({
            title: `#${x.number} · ${quoteTitle(x)}`,
            subtitle: [x.company || x.client_name, day(x.createdAt), x.createdByName].filter(Boolean).join(' · '),
            meta: money(t.total, x.currency),
            href: `/manual-quotes/${x.id}`,
          })),
          more: hits.length > limit ? { label: 'كل العروض اليدوية', href: '/manual-quotes' } : undefined,
        })
      : null
    return {
      card: ref,
      count: hits.length,
      total_SAR: sum('SAR'),
      total_USD: sum('USD'),
      quotes: shown.map(({ x, t }) => ({
        id: x.id, number: x.number, title: quoteTitle(x), company: x.company, client: x.client_name,
        items: x.items.length, total: t.total, currency: x.currency, created: x.createdAt.slice(0, 10), by: x.createdByName,
      })),
    }
  },
}

const manualGet: AiTool = {
  name: 'manual_quote_get',
  description: 'Open ONE manual quotation by its number (e.g. 105) or id: client info, every item, totals, VAT, delivery — plus a card with Download PDF / Download Excel / Edit buttons. Use when the user asks for a specific quote or wants to download/edit it.',
  parameters: {
    type: 'object',
    properties: {
      number: { type: 'integer', description: 'Quote number, e.g. 105.' },
      id: { type: 'string', description: 'Quote id if known from an earlier result.' },
    },
  },
  perms: ['page.furn'],
  status: 'يفتح العرض…',
  async run(args, ctx) {
    const id = str(args.id, 80)
    const num = int(args.number, 0, 0, 10_000_000)
    let q = id ? await getManualQuote(id) : null
    if (!q && num) q = (await listManualQuotes()).find((x) => x.number === num) || null
    if (!q) return { error: 'ما لقيت عرض يدوي بهذا الرقم.' }
    const t = quoteTotals(q)
    const ref = ctx.card({
      type: 'record',
      kind: `عرض سعر يدوي #${q.number}`,
      title: quoteTitle(q),
      subtitle: [q.company, q.client_name].filter(Boolean).join(' · ') || undefined,
      badge: { label: q.language === 'ar' ? 'عربي' : 'English', tone: 'slate' },
      amount: money(t.total, q.currency),
      fields: compact([
        { label: 'البنود', value: String(q.items.length) },
        { label: 'قبل الضريبة', value: money(t.subtotal, q.currency) },
        { label: 'الضريبة', value: q.vat_rate ? `${Math.round(q.vat_rate * 100)}% · ${money(t.vat, q.currency)}` : 'بدون ضريبة' },
        { label: 'التوصيل', value: q.delivery === 'included' ? 'شامل' : q.delivery === 'excluded' ? `غير شامل · ${money(t.shipping, q.currency)}` : '—' },
        { label: 'التاريخ', value: day(q.createdAt) },
        q.createdByName ? { label: 'أنشأه', value: q.createdByName } : null,
      ]),
      actions: compact([
        action('download', 'تحميل PDF', `/print/manual-quote/${q.id}`, true),
        action('download', 'تحميل إكسل', `/api/manual-quotes/${q.id}/template`, true),
        action('edit', 'تعديل', `/manual-quotes/${q.id}`),
      ]),
    })
    return {
      card: ref,
      number: q.number, title: quoteTitle(q), project: q.project_name, company: q.company, client: q.client_name,
      email: q.email, phone: q.phone, currency: q.currency, language: q.language,
      totals: t, vat_rate: q.vat_rate, delivery: q.delivery, notes: q.notes?.slice(0, 600),
      created: q.createdAt, updated: q.updatedAt, by: q.createdByName,
      items: q.items.slice(0, 80).map((i, n) => ({
        n: n + 1, description: i.description, details: i.details, quantity: i.quantity, unit: i.unit,
        unit_price: i.unit_price, total: (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
        notes: i.notes, admin_notes: i.adminNotes,
      })),
      items_truncated: q.items.length > 80,
    }
  },
}

// ── Furn ─────────────────────────────────────────────────────────────────────
const FURN_COLS = 'id, project_number, project_name, company_name, engineer_name, stage, status, ai_error, created_at, updated_at, boq_filename'

const furnList: AiTool = {
  name: 'furn_projects_list',
  description: 'Search / list Furn projects (الفرن — the AI BOQ pricing engine): by text (project, company, engineer, number), stage (processing / pricing / quoted), status, date range. Use furn_project_get for one project.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      stage: { type: 'string', enum: ['processing', 'pricing', 'quoted'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'rejected', 'archived'] },
      ...DATE_ARGS,
      limit: { type: 'integer', description: '1-25, default 8.' },
    },
  },
  perms: ['page.furn'],
  status: 'يبحث في مشاريع الفرن…',
  async run(args, ctx) {
    const q = likeSafe(str(args.query))
    const limit = int(args.limit, 8, 1, 25)
    let query = ctx.supabase.from('furn_projects').select(FURN_COLS, { count: 'exact' }).order('created_at', { ascending: false })
    if (q) {
      const n = Number(q.replace(/^#/, ''))
      query = Number.isInteger(n) && n > 0
        ? query.eq('project_number', n)
        : query.or(`project_name.ilike.%${q}%,company_name.ilike.%${q}%,engineer_name.ilike.%${q}%`)
    }
    if (str(args.stage)) query = query.eq('stage', str(args.stage))
    if (str(args.status)) query = query.eq('status', str(args.status))
    if (date(args.from)) query = query.gte('created_at', date(args.from))
    if (toEnd(args.to)) query = query.lte('created_at', toEnd(args.to))
    const { data, count, error } = await query.limit(limit)
    if (error) return { error: error.message }
    const rows = data || []
    const ref = rows.length
      ? ctx.card({
          type: 'list',
          title: 'مشاريع الفرن',
          total: count ?? rows.length,
          rows: rows.map((p) => ({
            title: `#${p.project_number} · ${p.project_name || '—'}`,
            subtitle: [p.company_name, day(p.created_at)].filter(Boolean).join(' · '),
            badge: p.ai_error ? { label: 'فشلت المعالجة', tone: 'red' as Tone } : FURN_STAGE[p.stage],
            href: `/furn/${p.id}`,
          })),
          more: (count ?? 0) > limit ? { label: 'كل مشاريع الفرن', href: '/furn' } : undefined,
        })
      : null
    return {
      card: ref, count: count ?? rows.length,
      projects: rows.map((p) => ({
        id: p.id, number: p.project_number, name: p.project_name, company: p.company_name, engineer: p.engineer_name,
        stage: p.stage, status: p.status, failed: !!p.ai_error, created: String(p.created_at).slice(0, 10),
      })),
    }
  },
}

const furnGet: AiTool = {
  name: 'furn_project_get',
  description: 'Open ONE Furn project by number or id: client, stage/status, the AI processing error if any, item count + priced/unpriced, the uploaded files (BOQ, specs, drawings, other) and every generated quotation with its PDF. Use for "وين وصل مشروع…", "وش ملفات…", "حمّل عرض الفرن…".',
  parameters: {
    type: 'object',
    properties: { number: { type: 'integer' }, id: { type: 'string' } },
  },
  perms: ['page.furn'],
  status: 'يفتح مشروع الفرن…',
  async run(args, ctx) {
    const id = str(args.id, 80)
    const num = int(args.number, 0, 0, 10_000_000)
    if (!id && !num) return { error: 'حدد رقم المشروع.' }
    let query = ctx.supabase.from('furn_projects').select('*')
    query = id ? query.eq('id', id) : query.eq('project_number', num)
    const { data: p } = await query.maybeSingle()
    if (!p) return { error: 'ما لقيت مشروع فرن بهذا الرقم.' }
    const [{ data: items }, { data: quotations }] = await Promise.all([
      ctx.supabase.from('furn_items').select('description, quantity, unit, unit_price').eq('project_id', p.id).order('position').limit(1000),
      ctx.supabase.from('furn_quotations').select('*').eq('project_id', p.id).order('generated_at', { ascending: false }).limit(10),
    ])
    const its = items || []
    const priced = its.filter((i) => Number(i.unit_price) > 0).length
    const files = [
      ...(p.boq_url ? [{ name: p.boq_filename || 'BOQ', url: p.boq_url, kind: 'BOQ' }] : []),
      ...((p.spec_files || []) as Array<{ name: string; url: string }>).map((f) => ({ ...f, kind: 'مواصفات' })),
      ...((p.drawing_files || []) as Array<{ name: string; url: string }>).map((f) => ({ ...f, kind: 'رسومات' })),
      ...((p.other_files || []) as Array<{ name: string; url: string }>).map((f) => ({ ...f, kind: 'أخرى' })),
    ]
    const latest = (quotations || [])[0]
    const stage = p.ai_error ? { label: 'فشلت المعالجة', tone: 'red' as Tone } : FURN_STAGE[p.stage]
    const ref = ctx.card({
      type: 'record',
      kind: `مشروع فرن #${p.project_number}`,
      title: p.project_name || '—',
      subtitle: [p.company_name, p.engineer_name].filter(Boolean).join(' · ') || undefined,
      badge: stage,
      amount: latest ? money(latest.total, latest.currency || 'SAR') : undefined,
      fields: compact([
        { label: 'البنود', value: `${its.length} (مسعّر ${priced})` },
        { label: 'الحالة', value: FURN_STATUS[p.status] || p.status },
        { label: 'الملفات', value: String(files.length) },
        { label: 'عروض صادرة', value: String((quotations || []).length) },
        { label: 'التاريخ', value: day(p.created_at) },
      ]),
      actions: compact([
        latest ? (fileAction('تحميل العرض PDF', latest.pdf_url) || action('download', 'تحميل العرض PDF', `/print/quotation/${p.id}/${latest.id}`, true)) : null,
        action('edit', 'تعديل', `/furn/${p.id}`),
      ]),
    })
    const filesRef = files.length
      ? ctx.card({
          type: 'list',
          title: `ملفات المشروع #${p.project_number}`,
          total: files.length,
          rows: files.slice(0, 15).map((f) => ({ title: f.name, subtitle: f.kind, href: isAppOwnedUrl(f.url) ? f.url : undefined })),
        })
      : null
    return {
      card: ref, files_card: filesRef,
      number: p.project_number, name: p.project_name, company: p.company_name, engineer: p.engineer_name,
      stage: p.stage, status: p.status, ai_error: p.ai_error ? String(p.ai_error).slice(0, 400) : null,
      items: its.length, priced, unpriced: its.length - priced,
      files: files.map((f) => ({ name: f.name, kind: f.kind })),
      quotations: (quotations || []).map((x) => ({ number: x.quotation_number, language: x.language, total: x.total, date: String(x.generated_at || '').slice(0, 10) })),
      sample_items: its.slice(0, 30).map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price })),
    }
  },
}

// ── Tannoor ──────────────────────────────────────────────────────────────────
const tannoorList: AiTool = {
  name: 'tannoor_projects_list',
  description: 'Search / list Tannoor projects (التنّور — catalogue auto-pricing): by text or number, with their latest quotation total.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' }, ...DATE_ARGS, limit: { type: 'integer', description: '1-25, default 8.' } },
  },
  perms: ['page.tannoor'],
  status: 'يبحث في التنّور…',
  async run(args, ctx) {
    const q = likeSafe(str(args.query))
    const limit = int(args.limit, 8, 1, 25)
    let query = ctx.supabase.from('tannoor_projects').select('*', { count: 'exact' }).order('created_at', { ascending: false })
    if (q) {
      const n = Number(q.replace(/^#/, ''))
      query = Number.isInteger(n) && n > 0
        ? query.eq('project_number', n)
        : query.or(`project_name_en.ilike.%${q}%,project_name_ar.ilike.%${q}%,company_en.ilike.%${q}%,company_ar.ilike.%${q}%`)
    }
    if (date(args.from)) query = query.gte('created_at', date(args.from))
    if (toEnd(args.to)) query = query.lte('created_at', toEnd(args.to))
    const { data, count, error } = await query.limit(limit)
    if (error) return { error: error.message }
    const rows = data || []
    const ref = rows.length
      ? ctx.card({
          type: 'list',
          title: 'مشاريع التنّور',
          total: count ?? rows.length,
          rows: rows.map((p) => ({
            title: `#${p.project_number} · ${p.project_name_ar || p.project_name_en || '—'}`,
            subtitle: [p.company_ar || p.company_en, day(p.created_at)].filter(Boolean).join(' · '),
            badge: p.stage === 'quoted' ? { label: 'تم التسعير', tone: 'emerald' as Tone } : { label: 'قيد المعالجة', tone: 'amber' as Tone },
            href: `/tannoor/${p.id}`,
          })),
        })
      : null
    return {
      card: ref, count: count ?? rows.length,
      projects: rows.map((p) => ({
        number: p.project_number, name: p.project_name_ar || p.project_name_en, company: p.company_ar || p.company_en,
        stage: p.stage, status: p.status, created: String(p.created_at).slice(0, 10),
      })),
    }
  },
}

export const QUOTE_TOOLS: AiTool[] = [manualList, manualGet, furnList, furnGet, tannoorList]
