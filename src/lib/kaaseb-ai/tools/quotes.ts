// Quotation tools: manual quotes (S3), Furn (Supabase + S3), Tannoor.

import { listManualQuotes, getManualQuote, type ManualQuote } from '@/lib/manual-quotes/store'
import { computeTotals } from '@/lib/quotation/totals'
import { isAppOwnedUrl } from '@/lib/s3'
import { action, bilingual, compact, money, day, type Tone, type AiCard } from '../cards'
import { type AiTool, str, int, matches, inRange, date, toEnd, likeSafe, DATE_ARGS, ilikeOr } from '../tool'

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

/** An item's custom-column values by column NAME (admin columns marked). */
function customValues(q: ManualQuote, i: ManualQuote['items'][number]): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const c of q.columns || []) {
    const v = String(i.custom?.[c.id] ?? '').trim()
    if (v) out[c.internal ? `${c.name} (للإدارة)` : c.name] = v.slice(0, 300)
  }
  return Object.keys(out).length ? out : undefined
}

function quoteTitle(q: ManualQuote) {
  return q.subject || q.project_name || q.company || q.client_name || 'بدون عنوان'
}

/** The manual-quote card (download PDF/Excel in AR/EN, edit). Also used after
 *  a confirmed chat edit, outside any tool run. */
export function quoteCard(q: ManualQuote): Omit<Extract<AiCard, { type: 'record' }>, 'ref'> {
  const t = quoteTotals(q)
  return {
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
      bilingual('تحميل PDF', `/print/manual-quote/${q.id}?lang=ar`, `/print/manual-quote/${q.id}?lang=en`),
      bilingual('تحميل إكسل', `/api/manual-quotes/${q.id}/template?lang=ar`, `/api/manual-quotes/${q.id}/template?lang=en`),
      action('edit', 'تعديل', `/manual-quotes/${q.id}`),
    ]),
  }
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
    const ref = ctx.card(quoteCard(q))
    // The lines themselves — for "وش البنود؟" when there are too many to list in words.
    const itemsRef = q.items.length
      ? ctx.card({
          type: 'list', title: `بنود عرض #${q.number}`, total: q.items.length,
          rows: q.items.slice(0, 40).map((i, n) => ({
            title: `${n + 1}. ${i.description || '—'}`,
            subtitle: [i.details, i.notes].filter(Boolean).join(' · ') || undefined,
            meta: `${i.quantity} ${i.unit}${i.unit_price != null ? ` × ${i.unit_price}` : ''}`,
          })),
          more: q.items.length > 40 ? { label: 'كل البنود في صفحة العرض', href: `/manual-quotes/${q.id}` } : undefined,
        })
      : null
    return {
      card: ref, items_card: itemsRef,
      number: q.number, title: quoteTitle(q), project: q.project_name, company: q.company, client: q.client_name,
      email: q.email, phone: q.phone, currency: q.currency, language: q.language,
      totals: t, vat_rate: q.vat_rate, delivery: q.delivery, notes: q.notes?.slice(0, 600),
      created: q.createdAt, updated: q.updatedAt, by: q.createdByName,
      // Management-only columns are named "(للإدارة)" so the model can say so.
      columns: (q.columns || []).map((c) => (c.internal ? `${c.name} (للإدارة)` : c.name)),
      items: q.items.slice(0, 150).map((i, n) => ({
        n: n + 1, description: i.description, details: i.details, quantity: i.quantity, unit: i.unit,
        unit_price: i.unit_price, total: (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
        notes: i.notes || undefined, admin_notes: i.adminNotes || undefined,
        columns: customValues(q, i),
      })),
      items_truncated: q.items.length > 150,
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
        : query.or(ilikeOr(['project_name', 'company_name', 'engineer_name'], q))
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
      // select('*'): the same read the Furn page does — no guessing at live columns.
      ctx.supabase.from('furn_items').select('*').eq('project_id', p.id).order('position').limit(1000),
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
    const latestIn = (l: 'ar' | 'en') => (quotations || []).find((x) => x.language === l) || null
    const pdfHref = (pid: string, x: { id: string; pdf_url?: string | null } | null) =>
      !x ? null : fileAction('', x.pdf_url)?.href || `/print/quotation/${pid}/${x.id}`
    const stage =p.ai_error ? { label: 'فشلت المعالجة', tone: 'red' as Tone } : FURN_STAGE[p.stage]
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
        // Furn issues one quotation per language — offer each one that exists.
        bilingual('تحميل العرض PDF', pdfHref(p.id, latestIn('ar')), pdfHref(p.id, latestIn('en'))),
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
    const itemsRef = its.length
      ? ctx.card({
          type: 'list', title: `بنود مشروع الفرن #${p.project_number}`, total: its.length,
          rows: its.slice(0, 40).map((i, n) => ({
            title: `${n + 1}. ${i.description || '—'}`,
            subtitle: i.details ? String(i.details).slice(0, 120) : undefined,
            meta: `${i.quantity} ${i.unit}${Number(i.unit_price) > 0 ? ` × ${i.unit_price}` : ''}`,
            badge: Number(i.unit_price) > 0 ? undefined : { label: 'بدون سعر', tone: 'amber' as Tone },
          })),
          more: its.length > 40 ? { label: 'كل البنود في صفحة المشروع', href: `/furn/${p.id}` } : undefined,
        })
      : null
    return {
      card: ref, items_card: itemsRef, files_card: filesRef,
      number: p.project_number, name: p.project_name, company: p.company_name, engineer: p.engineer_name,
      stage: p.stage, status: p.status, ai_error: p.ai_error ? String(p.ai_error).slice(0, 400) : null,
      items: its.length, priced, unpriced: its.length - priced,
      files: files.map((f) => ({ name: f.name, kind: f.kind })),
      quotations: (quotations || []).map((x) => ({ number: x.quotation_number, language: x.language, total: x.total, date: String(x.generated_at || '').slice(0, 10) })),
      items_list: its.slice(0, 150).map((i, n) => ({
        n: n + 1, description: i.description, details: i.details || undefined, quantity: i.quantity, unit: i.unit,
        unit_price: i.unit_price, team_notes: i.notes || undefined,
      })),
      items_truncated: its.length > 150,
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
        : query.or(ilikeOr(['project_name_en', 'project_name_ar', 'company_en', 'company_ar'], q))
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

// ── line items across every quote ────────────────────────────────────────────
const itemsSearch: AiTool = {
  name: 'items_search',
  description: 'Find LINE ITEMS (بنود) across every manual quote and Furn project by text in the description, details, team notes, MANAGEMENT notes (ملاحظات الإدارة) and management-only columns (e.g. سعر الشراء). Use for "أي عرض فيه بند…", "وش ملاحظة الإدارة على بند…", "بكم سعّرنا…".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Item text; send both spellings with | (e.g. "كرارا|carrara").' },
      limit: { type: 'integer', description: '1-25, default 10.' },
    },
    required: ['query'],
  },
  perms: ['page.furn'],
  status: 'يبحث في البنود…',
  async run(args, ctx) {
    const q = str(args.query)
    if (!q) return { error: 'وش البند اللي أدور عليه؟' }
    const limit = int(args.limit, 10, 1, 25)
    type Hit = { source: string; ref: string; href: string; description: string; details?: string; quantity: unknown; unit: string; unit_price: unknown; notes?: string; admin_notes?: string; columns?: Record<string, string>; date: string }
    const hits: Hit[] = []

    for (const x of await listManualQuotes()) {
      for (const i of x.items || []) {
        const cols = customValues(x, i)
        if (!matches(q, i.description, i.details, i.notes, i.adminNotes, cols && Object.values(cols).join(' '))) continue
        hits.push({
          source: 'عرض يدوي', ref: `#${x.number} · ${quoteTitle(x)}`, href: `/manual-quotes/${x.id}`,
          description: i.description, details: i.details || undefined, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price,
          notes: i.notes || undefined, admin_notes: i.adminNotes || undefined, columns: cols, date: x.createdAt,
        })
      }
    }

    const { data: furnItems } = await ctx.supabase.from('furn_items').select('*')
      .or(ilikeOr(['description', 'details', 'notes'], likeSafe(q))).limit(60)
    const ids = [...new Set((furnItems || []).map((i) => i.project_id as string))]
    const { data: projects } = ids.length
      ? await ctx.supabase.from('furn_projects').select('id, project_number, project_name, created_at').in('id', ids)
      : { data: [] as Array<{ id: string; project_number: number; project_name: string; created_at: string }> }
    const byId = new Map((projects || []).map((p) => [p.id, p]))
    for (const i of furnItems || []) {
      const p = byId.get(i.project_id)
      if (!p) continue
      hits.push({
        source: 'الفرن', ref: `#${p.project_number} · ${p.project_name}`, href: `/furn/${p.id}`,
        description: i.description, details: i.details || undefined, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price,
        notes: i.notes || undefined, date: p.created_at,
      })
    }

    hits.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const shown = hits.slice(0, limit)
    const ref = shown.length
      ? ctx.card({
          type: 'list', title: `بنود «${q.split('|')[0].slice(0, 30)}»`, total: hits.length,
          rows: shown.map((h) => ({
            title: h.description,
            subtitle: [h.ref, h.admin_notes ? `ملاحظة الإدارة: ${h.admin_notes}` : ''].filter(Boolean).join(' · '),
            meta: h.unit_price != null && h.unit_price !== '' ? `${h.unit_price} / ${h.unit}` : undefined,
            badge: { label: h.source, tone: (h.source === 'الفرن' ? 'violet' : 'blue') as Tone },
            href: h.href,
          })),
        })
      : null
    return {
      card: ref, count: hits.length,
      items: shown.map((h) => ({
        source: h.source, quote_or_project: h.ref, description: h.description, details: h.details, quantity: h.quantity, unit: h.unit,
        unit_price: h.unit_price, notes: h.notes, admin_notes: h.admin_notes, columns: h.columns, date: String(h.date).slice(0, 10),
      })),
    }
  },
}

export const QUOTE_TOOLS: AiTool[] = [manualList, manualGet, itemsSearch, furnList, furnGet, tannoorList]
