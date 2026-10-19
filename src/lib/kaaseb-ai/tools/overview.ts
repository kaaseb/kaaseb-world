// Cross-module tools: a stats overview and one search box over everything the
// user may see. Both only touch the sections the user has permission for.

import { listManualQuotes } from '@/lib/manual-quotes/store'
import { getInboxState } from '@/lib/inbox/store'
import { inboxUnlocked } from '@/lib/inbox/lock'
import { getState as getOpportunities } from '@/lib/opportunities/store'
import { getCompaniesState } from '@/lib/companies/store'
import { money, type CardStat, type Tone } from '../cards'
import { type AiTool, type ToolCtx, str, matches, inRange, date, toEnd, likeSafe, DATE_ARGS, ilikeOr } from '../tool'
import { quoteTotals, FURN_STAGE } from './quotes'
import { CP_STATUS } from './crm'

function monthStart(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

const overview: AiTool = {
  name: 'overview',
  description: 'A numbers dashboard across every section the user can access, for a period (default: this month): manual quotes count + value, Furn projects by stage, client projects by status (and overdue), unread emails, new opportunities, the user\'s own open tasks. Use for "وش الوضع", "إحصائيات", "ملخص الشهر".',
  parameters: { type: 'object', properties: { ...DATE_ARGS } },
  perms: [],
  status: 'يجهّز الإحصائيات…',
  async run(args, ctx) {
    const from = date(args.from) || monthStart()
    const to = toEnd(args.to)
    const stats: CardStat[] = []
    const data: Record<string, unknown> = { period: { from: from.slice(0, 10), to: (to || new Date().toISOString()).slice(0, 10) } }
    const jobs: Promise<void>[] = []

    if (ctx.can('page.furn')) {
      jobs.push((async () => {
        const qs = (await listManualQuotes()).filter((q) => inRange(q.createdAt, from, to))
        const sar = qs.filter((q) => q.currency === 'SAR').reduce((n, q) => n + quoteTotals(q).total, 0)
        stats.push({ label: 'عروض يدوية', value: String(qs.length), tone: 'blue', hint: money(sar) })
        data.manual_quotes = { count: qs.length, total_SAR: sar }
      })())
      jobs.push((async () => {
        let q = ctx.supabase.from('furn_projects').select('stage, ai_error').gte('created_at', from)
        if (to) q = q.lte('created_at', to)
        const { data: rows } = await q.limit(2000)
        const by = (s: string) => (rows || []).filter((r) => r.stage === s && !r.ai_error).length
        const failed = (rows || []).filter((r) => r.ai_error).length
        stats.push({ label: 'مشاريع الفرن', value: String((rows || []).length), tone: 'violet', hint: `${by('quoted')} ${FURN_STAGE.quoted.label} · ${by('pricing')} تسعير` })
        if (failed) stats.push({ label: 'فرن فشلت معالجته', value: String(failed), tone: 'red' })
        data.furn = { total: (rows || []).length, processing: by('processing'), pricing: by('pricing'), quoted: by('quoted'), failed }
      })())
    }
    if (ctx.can('page.client_projects')) {
      jobs.push((async () => {
        const { data: rows } = await ctx.supabase.from('client_projects').select('status, end_date').limit(5000)
        const today = new Date().toISOString().slice(0, 10)
        const open = (rows || []).filter((r) => r.status !== 'completed' && r.status !== 'rejected')
        const late = open.filter((r) => r.end_date && r.end_date < today).length
        const counts: Record<string, number> = {}
        for (const r of rows || []) counts[r.status] = (counts[r.status] || 0) + 1
        stats.push({ label: 'مشاريع مفتوحة', value: String(open.length), tone: 'amber', hint: `${counts.awaiting_reply || 0} ${CP_STATUS.awaiting_reply.label}` })
        if (late) stats.push({ label: 'مشاريع متأخرة', value: String(late), tone: 'red' })
        data.client_projects = { open: open.length, overdue: late, by_status: counts }
      })())
    }
    if (ctx.can('page.inbox')) {
      jobs.push((async () => {
        if (!(await inboxUnlocked())) { data.inbox = 'locked'; return }
        const { items } = await getInboxState()
        const unread = items.filter((e) => !e.read).length
        const fresh = items.filter((e) => e.status === 'new' && inRange(e.date, from, to)).length
        stats.push({ label: 'إيميلات غير مقروءة', value: String(unread), tone: unread ? 'blue' : 'emerald', hint: `${fresh} وارد بالفترة` })
        data.inbox = { unread, received_in_period: fresh }
      })())
    }
    if (ctx.can('page.opportunities')) {
      jobs.push((async () => {
        const { items } = await getOpportunities()
        const fresh = items.filter((o) => o.status === 'new').length
        stats.push({ label: 'فرص جديدة', value: String(fresh), tone: 'emerald' })
        data.opportunities = { new: fresh, total: items.length }
      })())
    }
    jobs.push((async () => {
      const { data: rows } = await ctx.supabase.from('daily_tasks').select('expires_at').eq('assigned_user_id', ctx.user.id).eq('completed', false).limit(500)
      const late = (rows || []).filter((r) => r.expires_at && r.expires_at < new Date().toISOString()).length
      stats.push({ label: 'مهامك المفتوحة', value: String((rows || []).length), tone: late ? 'red' : 'slate', hint: late ? `${late} متأخرة` : undefined })
      data.my_tasks = { open: (rows || []).length, overdue: late }
    })())

    await Promise.allSettled(jobs)
    const order: Tone[] = ['red', 'blue', 'violet', 'amber', 'emerald', 'slate']
    stats.sort((a, b) => order.indexOf(a.tone || 'slate') - order.indexOf(b.tone || 'slate'))
    const ref = ctx.card({ type: 'stats', title: `الإحصائيات · من ${from.slice(0, 10)}`, stats })
    return { card: ref, ...data }
  },
}

const search: AiTool = {
  name: 'search_everything',
  description: 'One search over EVERYTHING the user can access: manual quotes, Furn projects, client projects, Tannoor, inbox, opportunities, target companies. Use when the user names a client/company/project and you don\'t know which section it lives in.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, company, number…' } }, required: ['query'] },
  perms: [],
  status: 'يبحث في كل الأقسام…',
  async run(args, ctx: ToolCtx) {
    const q = str(args.query)
    if (!q) return { error: 'وش أبحث عنه؟' }
    const safe = likeSafe(q)
    type Hit = { section: string; title: string; subtitle?: string; href?: string; tone: Tone }
    const hits: Hit[] = []
    const jobs: Promise<void>[] = []
    const num = Number(q.replace(/^#/, ''))
    const isNum = Number.isInteger(num) && num > 0

    if (ctx.can('page.furn')) {
      jobs.push((async () => {
        for (const x of (await listManualQuotes()).filter((x) => (isNum && x.number === num) || matches(q, x.subject, x.project_name, x.company, x.client_name)).slice(0, 5)) {
          hits.push({ section: 'عرض يدوي', title: `#${x.number} · ${x.subject || x.project_name || x.company || '—'}`, subtitle: x.company || x.client_name, href: `/manual-quotes/${x.id}`, tone: 'blue' })
        }
      })())
      if (safe) jobs.push((async () => {
        const base = ctx.supabase.from('furn_projects').select('id, project_number, project_name, company_name')
        const { data } = await (isNum ? base.eq('project_number', num) : base.or(ilikeOr(['project_name', 'company_name', 'engineer_name'], safe))).limit(5)
        for (const p of data || []) hits.push({ section: 'الفرن', title: `#${p.project_number} · ${p.project_name}`, subtitle: p.company_name, href: `/furn/${p.id}`, tone: 'violet' })
      })())
    }
    if (ctx.can('page.client_projects') && safe) {
      jobs.push((async () => {
        const base = ctx.supabase.from('client_projects').select('id, project_number, name_ar, name_en, company_ar, company_en')
        const { data } = await (isNum ? base.eq('project_number', num) : base.or(ilikeOr(['name_en', 'name_ar', 'company_en', 'company_ar', 'engineer_name_en', 'engineer_name_ar'], safe))).limit(5)
        for (const p of data || []) hits.push({ section: 'مشروع', title: `#${p.project_number} · ${p.name_ar || p.name_en}`, subtitle: p.company_ar || p.company_en || undefined, href: `/projects/${p.id}`, tone: 'amber' })
      })())
    }
    if (ctx.can('page.tannoor') && safe && !isNum) {
      jobs.push((async () => {
        const { data } = await ctx.supabase.from('tannoor_projects').select('id, project_number, project_name_ar, project_name_en, company_ar, company_en')
          .or(ilikeOr(['project_name_en', 'project_name_ar', 'company_en', 'company_ar'], safe)).limit(3)
        for (const p of data || []) hits.push({ section: 'التنّور', title: `#${p.project_number} · ${p.project_name_ar || p.project_name_en}`, subtitle: p.company_ar || p.company_en || undefined, href: `/tannoor/${p.id}`, tone: 'slate' })
      })())
    }
    if (ctx.can('page.inbox')) {
      jobs.push((async () => {
        if (!(await inboxUnlocked())) return
        const { items } = await getInboxState()
        for (const e of items.filter((e) => matches(q, e.subject, e.fromName, e.fromEmail, e.preview?.projectName)).slice(0, 4)) {
          hits.push({ section: 'إيميل', title: e.subject || '(بدون عنوان)', subtitle: e.fromName || e.fromEmail, href: e.projectId ? `/projects/${e.projectId}` : '/inbox', tone: 'blue' })
        }
      })())
    }
    if (ctx.can('page.opportunities')) {
      jobs.push((async () => {
        const { items } = await getOpportunities()
        for (const o of items.filter((o) => matches(q, o.title, o.owner, o.city)).slice(0, 3)) hits.push({ section: 'فرصة', title: o.title, subtitle: o.owner, href: '/opportunities', tone: 'emerald' })
      })())
    }
    if (ctx.can('page.companies')) {
      jobs.push((async () => {
        const { items } = await getCompaniesState()
        for (const c of items.filter((c) => matches(q, c.name, c.city, c.category)).slice(0, 3)) hits.push({ section: 'شركة مستهدفة', title: c.name, subtitle: c.city, href: '/companies', tone: 'emerald' })
      })())
    }
    await Promise.allSettled(jobs)
    const ref = hits.length
      ? ctx.card({ type: 'list', title: `نتائج «${q.slice(0, 40)}»`, total: hits.length, rows: hits.slice(0, 15).map((h) => ({ title: h.title, subtitle: h.subtitle, badge: { label: h.section, tone: h.tone }, href: h.href })) })
      : null
    return { card: ref, count: hits.length, results: hits.slice(0, 20).map((h) => ({ section: h.section, title: h.title, company: h.subtitle })) }
  },
}

export const OVERVIEW_TOOLS: AiTool[] = [overview, search]
