// People, tasks, goals, calendar, documents, audit, finances.

import { createAdminClient } from '@/lib/supabase/admin'
import { docsUnlocked } from '@/lib/docs/lock'
import { isAppOwnedUrl } from '@/lib/s3'
import { compact, day, money, type Tone } from '../cards'
import { type AiTool, str, int, bool, matches, date, toEnd, DATE_ARGS } from '../tool'
import { fileAction } from './quotes'

const nowIso = () => new Date().toISOString()
const isManager = (role: string) => role === 'super_admin' || role === 'project_manager'

// ── my work (everyone) ───────────────────────────────────────────────────────
const myWork: AiTool = {
  name: 'my_work',
  description: 'The CURRENT user\'s own work: their open daily tasks (and which are overdue), project-board tasks assigned to them, and unread notifications. Use for "وش علي اليوم؟", "مهامي", "إشعاراتي".',
  parameters: { type: 'object', properties: {} },
  perms: [],
  status: 'يجمع مهامك…',
  async run(_args, ctx) {
    const uid = ctx.user.id
    const [daily, board, notes] = await Promise.all([
      ctx.supabase.from('daily_tasks').select('id, title, completed, expires_at, points').eq('assigned_user_id', uid).eq('completed', false).order('expires_at', { ascending: true }).limit(30),
      ctx.supabase.from('tasks').select('id, title, status, points, project_id, projects(name)').eq('assigned_user_id', uid).not('status', 'in', '("done","completed")').limit(30),
      ctx.supabase.from('notifications').select('id, title, message, created_at, read_at').or(`recipient_id.eq.${uid},is_broadcast.eq.true`).is('read_at', null).order('created_at', { ascending: false }).limit(10),
    ])
    const d = daily.data || []
    const overdue = d.filter((t) => t.expires_at && t.expires_at < nowIso())
    const rows = [
      ...d.map((t) => ({
        title: t.title,
        subtitle: t.expires_at ? `ينتهي ${day(t.expires_at)}` : 'مهمة يومية',
        badge: t.expires_at && t.expires_at < nowIso() ? { label: 'متأخرة', tone: 'red' as Tone } : { label: 'مفتوحة', tone: 'amber' as Tone },
        href: '/daily-tasks',
      })),
      ...(board.data || []).map((t) => {
        const proj = (Array.isArray(t.projects) ? t.projects[0] : t.projects) as { name?: string } | null
        return { title: t.title, subtitle: proj?.name || 'مهمة مشروع', badge: { label: 'مشروع', tone: 'violet' as Tone }, href: t.project_id ? `/project-board/${t.project_id}` : undefined }
      }),
    ]
    const ref = rows.length ? ctx.card({ type: 'list', title: 'مهامك المفتوحة', total: rows.length, rows: rows.slice(0, 12) }) : null
    return {
      card: ref,
      daily_open: d.length, daily_overdue: overdue.length, board_open: (board.data || []).length,
      tasks: rows.slice(0, 20).map((r) => ({ title: r.title, info: r.subtitle, state: r.badge.label })),
      unread_notifications: (notes.data || []).map((n) => ({ title: n.title, message: String(n.message || '').slice(0, 200), date: String(n.created_at).slice(0, 10) })),
    }
  },
}

// ── team tasks (managers) ────────────────────────────────────────────────────
const teamTasks: AiTool = {
  name: 'team_tasks',
  description: 'Team-wide open / overdue daily tasks, optionally for one employee by name. Managers only. Use for "مين عنده مهام متأخرة؟", "مهام فلان".',
  parameters: {
    type: 'object',
    properties: { employee: { type: 'string', description: 'Employee name (optional).' }, overdue_only: { type: 'boolean' }, limit: { type: 'integer', description: '1-40, default 15.' } },
  },
  perms: ['page.daily_tasks'],
  status: 'يراجع مهام الفريق…',
  async run(args, ctx) {
    if (!isManager(ctx.profile.role)) return { error: 'مهام الفريق متاحة للمدراء فقط. أقدر أعرض لك مهامك أنت.' }
    let q = ctx.supabase.from('daily_tasks')
      .select('id, title, expires_at, assigned_user_id, profiles:assigned_user_id(full_name)')
      .eq('completed', false).order('expires_at', { ascending: true }).limit(500)
    if (bool(args.overdue_only)) q = q.lt('expires_at', nowIso())
    const { data, error } = await q
    if (error) return { error: error.message }
    const who = str(args.employee)
    const nameOf = (t: { profiles?: unknown }) => {
      const p = t.profiles as { full_name?: string | null } | Array<{ full_name?: string | null }> | null
      return (Array.isArray(p) ? p[0]?.full_name : p?.full_name) || '—'
    }
    const rows = (data || []).filter((t) => !who || matches(who, nameOf(t)))
    const perPerson = new Map<string, { open: number; overdue: number }>()
    for (const t of rows) {
      const k = nameOf(t)
      const v = perPerson.get(k) || { open: 0, overdue: 0 }
      v.open++
      if (t.expires_at && t.expires_at < nowIso()) v.overdue++
      perPerson.set(k, v)
    }
    const people = [...perPerson.entries()].sort((a, b) => b[1].overdue - a[1].overdue || b[1].open - a[1].open)
    const limit = int(args.limit, 15, 1, 40)
    const ref = people.length
      ? ctx.card({
          type: 'list', title: 'مهام الفريق المفتوحة', total: rows.length,
          rows: people.slice(0, limit).map(([name, v]) => ({
            title: name, meta: String(v.open),
            badge: v.overdue ? { label: `${v.overdue} متأخرة`, tone: 'red' as Tone } : { label: 'بالموعد', tone: 'emerald' as Tone },
          })),
        })
      : null
    return {
      card: ref, open_total: rows.length,
      per_person: people.slice(0, limit).map(([name, v]) => ({ name, ...v })),
      tasks: rows.slice(0, 30).map((t) => ({ title: t.title, employee: nameOf(t), due: t.expires_at ? String(t.expires_at).slice(0, 10) : null, overdue: !!t.expires_at && t.expires_at < nowIso() })),
    }
  },
}

// ── goals ────────────────────────────────────────────────────────────────────
const goals: AiTool = {
  name: 'goals_list',
  description: 'Company / department goals with their steps progress.',
  parameters: { type: 'object', properties: { completed: { type: 'boolean' }, query: { type: 'string' } } },
  perms: ['page.goals'],
  status: 'يراجع الأهداف…',
  async run(args, ctx) {
    let q = ctx.supabase.from('goals').select('id, title, description, completed, created_at, departments(name), goal_steps(completed)').order('created_at', { ascending: false }).limit(60)
    const c = bool(args.completed)
    if (c !== undefined) q = q.eq('completed', c)
    const { data, error } = await q
    if (error) return { error: error.message }
    const text = str(args.query)
    const rows = (data || []).filter((g) => !text || matches(text, g.title, g.description)).map((g) => {
      const steps = (g.goal_steps || []) as Array<{ completed: boolean }>
      const done = steps.filter((s) => s.completed).length
      const dept = (Array.isArray(g.departments) ? g.departments[0] : g.departments) as { name?: string } | null
      return { g, steps: steps.length, done, dept: dept?.name || '' }
    })
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'الأهداف', total: rows.length,
          rows: rows.slice(0, 12).map((r) => ({
            title: r.g.title, subtitle: r.dept || undefined,
            meta: r.steps ? `${r.done}/${r.steps}` : undefined,
            badge: r.g.completed ? { label: 'مكتمل', tone: 'emerald' as Tone } : { label: 'جاري', tone: 'amber' as Tone },
            href: `/goals/${r.g.id}`,
          })),
        })
      : null
    return { card: ref, goals: rows.slice(0, 30).map((r) => ({ title: r.g.title, completed: r.g.completed, department: r.dept, steps_done: r.done, steps_total: r.steps })) }
  },
}

// ── team members ─────────────────────────────────────────────────────────────
const team: AiTool = {
  name: 'team_members',
  description: 'Employees: name, role, title, points, last seen. Optional name search. Use for "مين في الفريق", "أعلى نقاط".',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: '1-50, default 20.' } } },
  perms: ['page.users'],
  status: 'يراجع الفريق…',
  async run(args, ctx) {
    const { data, error } = await ctx.supabase.from('profiles').select('id, full_name, email, role, title, total_points, last_seen_at').order('total_points', { ascending: false }).limit(300)
    if (error) return { error: error.message }
    const text = str(args.query)
    const rows = (data || []).filter((p) => !text || matches(text, p.full_name, p.email, p.title))
    const limit = int(args.limit, 20, 1, 50)
    const ROLE: Record<string, string> = { super_admin: 'مدير عام', project_manager: 'مدير مشاريع', employee: 'موظف' }
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'الفريق', total: rows.length,
          rows: rows.slice(0, limit).map((p) => ({ title: p.full_name || p.email, subtitle: [ROLE[p.role] || p.role, p.title].filter(Boolean).join(' · '), meta: `${p.total_points ?? 0}` })),
        })
      : null
    return { card: ref, count: rows.length, members: rows.slice(0, limit).map((p) => ({ name: p.full_name, email: p.email, role: p.role, title: p.title, points: p.total_points, last_seen: p.last_seen_at })) }
  },
}

// ── calendar ─────────────────────────────────────────────────────────────────
const calendar: AiTool = {
  name: 'calendar_events',
  description: 'Calendar events / meetings in a date range (default: today → next 14 days).',
  parameters: { type: 'object', properties: { ...DATE_ARGS } },
  perms: ['page.calendar'],
  status: 'يراجع التقويم…',
  async run(args, ctx) {
    const from = (date(args.from) || nowIso()).slice(0, 10)
    const to = (toEnd(args.to) || new Date(Date.now() + 14 * 864e5).toISOString()).slice(0, 10)
    const { data, error } = await ctx.supabase.from('events')
      .select('id, title, description, event_date, event_time, location, meeting_url, priority')
      .gte('event_date', from).lte('event_date', to).order('event_date').limit(40)
    if (error) return { error: error.message }
    const rows = data || []
    const ref = rows.length
      ? ctx.card({ type: 'list', title: 'التقويم', total: rows.length, rows: rows.slice(0, 12).map((e) => ({ title: e.title, subtitle: [day(e.event_date), e.event_time, e.location].filter(Boolean).join(' · '), href: '/calendar' })) })
      : null
    return { card: ref, from, to, events: rows.map((e) => ({ title: e.title, date: e.event_date, time: e.event_time, location: e.location, description: String(e.description || '').slice(0, 200) })) }
  },
}

// ── documents ────────────────────────────────────────────────────────────────
const documents: AiTool = {
  name: 'important_documents',
  description: 'Company important documents (السجل التجاري، الشهادات، التراخيص…) with expiry dates and download links. Use "expiring_within_days" for "وش اللي بينتهي قريب".',
  parameters: { type: 'object', properties: { query: { type: 'string' }, expiring_within_days: { type: 'integer' } } },
  perms: ['page.important_docs'],
  status: 'يراجع المستندات…',
  async run(args, ctx) {
    if (!(await docsUnlocked())) return { locked: true, card: ctx.card({ type: 'unlock', target: 'docs', title: 'المستندات المهمة مقفلة برمز' }), message: 'المستندات مقفلة. اعرض بطاقة الفتح ليكتب الرمز فيها — لا تطلب الرمز في النص.' }
    const { data, error } = await ctx.supabase.from('important_documents').select('id, name_ar, name_en, file_url, expiry_date, notes').order('expiry_date', { ascending: true }).limit(200)
    if (error) return { error: error.message }
    const text = str(args.query)
    const within = int(args.expiring_within_days, 0, 0, 3650)
    const today = new Date().toISOString().slice(0, 10)
    const limitDate = new Date(Date.now() + within * 864e5).toISOString().slice(0, 10)
    const rows = (data || [])
      .filter((d) => !text || matches(text, d.name_ar, d.name_en, d.notes))
      .filter((d) => !within || (d.expiry_date && d.expiry_date <= limitDate))
    const tone = (d: { expiry_date: string | null }) =>
      !d.expiry_date ? undefined : d.expiry_date < today ? { label: 'منتهي', tone: 'red' as Tone } : d.expiry_date <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? { label: 'قريب الانتهاء', tone: 'amber' as Tone } : { label: 'ساري', tone: 'emerald' as Tone }
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'المستندات المهمة', total: rows.length,
          rows: rows.slice(0, 15).map((d) => ({ title: d.name_ar || d.name_en || '—', subtitle: d.expiry_date ? `ينتهي ${day(d.expiry_date)}` : 'بدون تاريخ انتهاء', badge: tone(d), href: fileAction('', d.file_url)?.href || '/important-docs' })),
        })
      : null
    return { card: ref, documents: rows.slice(0, 40).map((d) => ({ name: d.name_ar || d.name_en, expiry: d.expiry_date, expired: !!d.expiry_date && d.expiry_date < today, downloadable: !!d.file_url && isAppOwnedUrl(d.file_url) })) }
  },
}

const prequal: AiTool = {
  name: 'pre_qualifications',
  description: 'Pre-qualification packages (التأهيل المسبق) prepared for clients, with their generated PDF.',
  parameters: { type: 'object', properties: { query: { type: 'string' } } },
  perms: ['page.pre_qualifications'],
  status: 'يراجع التأهيل المسبق…',
  async run(args, ctx) {
    const { data, error } = await ctx.supabase.from('pre_qualifications').select('*').order('created_at', { ascending: false }).limit(100)
    if (error) return { error: error.message }
    const text = str(args.query)
    const rows = (data || []).filter((p) => !text || matches(text, p.company_ar, p.company_en, p.project_name_ar, p.project_name_en))
    const ref = rows.length
      ? ctx.card({
          type: 'list', title: 'التأهيل المسبق', total: rows.length,
          rows: rows.slice(0, 12).map((p) => ({
            title: p.company_ar || p.company_en || '—', subtitle: [p.project_name_ar || p.project_name_en, p.generated_at ? day(p.generated_at) : 'لم يُولَّد بعد'].filter(Boolean).join(' · '),
            href: fileAction('', p.output_pdf_url)?.href || '/pre-qualifications',
          })),
        })
      : null
    return { card: ref, packages: rows.slice(0, 30).map((p) => ({ company: p.company_ar || p.company_en, project: p.project_name_ar || p.project_name_en, generated: p.generated_at, has_pdf: !!p.output_pdf_url })) }
  },
}

// ── super admin only ─────────────────────────────────────────────────────────
const audit: AiTool = {
  name: 'audit_log',
  description: 'Who did what in the system (سجل التدقيق): filter by employee name, action, object, date range. Super admin only.',
  parameters: { type: 'object', properties: { employee: { type: 'string' }, query: { type: 'string' }, ...DATE_ARGS, limit: { type: 'integer', description: '1-40, default 15.' } } },
  perms: ['page.audit'],
  adminOnly: true,
  status: 'يراجع سجل التدقيق…',
  async run(args, ctx) {
    let q = ctx.supabase.from('audit_logs').select('user_name, user_email, action_type, object_type, object_name, created_at').order('created_at', { ascending: false }).limit(400)
    if (date(args.from)) q = q.gte('created_at', date(args.from))
    if (toEnd(args.to)) q = q.lte('created_at', toEnd(args.to))
    const { data, error } = await q
    if (error) return { error: error.message }
    const who = str(args.employee)
    const text = str(args.query)
    const rows = (data || []).filter((r) => (!who || matches(who, r.user_name, r.user_email)) && (!text || matches(text, r.action_type, r.object_type, r.object_name)))
    const limit = int(args.limit, 15, 1, 40)
    const ref = rows.length
      ? ctx.card({ type: 'list', title: 'سجل التدقيق', total: rows.length, rows: rows.slice(0, limit).map((r) => ({ title: r.object_name || r.object_type, subtitle: [r.user_name || r.user_email, r.action_type, day(r.created_at)].filter(Boolean).join(' · '), href: '/audit' })) })
      : null
    return { card: ref, count: rows.length, entries: rows.slice(0, limit).map((r) => ({ who: r.user_name || r.user_email, action: r.action_type, object: r.object_type, name: r.object_name, at: String(r.created_at).slice(0, 16) })) }
  },
}

const finances: AiTool = {
  name: 'finances_summary',
  description: 'Company finances: recurring dues (what is due soon / overdue), income sources, financial goals. Super admin only.',
  parameters: { type: 'object', properties: { due_within_days: { type: 'integer', description: 'Default 30.' } } },
  perms: [],
  adminOnly: true,
  status: 'يراجع المالية…',
  async run(args, ctx) {
    // The finances page itself reads with the service client (super-admin page).
    const admin = createAdminClient()
    const [dues, income, goals] = await Promise.all([
      admin.from('finance_dues').select('platform, amount, status, next_payment_date, category').order('next_payment_date', { ascending: true }).limit(200),
      admin.from('finance_income').select('source, amount, type').limit(200),
      admin.from('finance_goals').select('name, target_amount, current_amount, deadline').limit(50),
    ])
    const within = int(args.due_within_days, 30, 1, 365)
    const today = new Date().toISOString().slice(0, 10)
    const until = new Date(Date.now() + within * 864e5).toISOString().slice(0, 10)
    const d = dues.data || []
    const soon = d.filter((x) => x.next_payment_date && x.next_payment_date <= until)
    const overdue = soon.filter((x) => x.next_payment_date < today)
    const sum = (xs: Array<{ amount: number | null }>) => xs.reduce((n, x) => n + (Number(x.amount) || 0), 0)
    const statsRef = ctx.card({
      type: 'stats', title: 'المالية',
      stats: compact([
        { label: `مستحق خلال ${within} يوم`, value: money(sum(soon)), tone: 'amber' as Tone, hint: `${soon.length} دفعة` },
        { label: 'متأخر', value: money(sum(overdue)), tone: overdue.length ? 'red' as Tone : 'emerald' as Tone, hint: `${overdue.length} دفعة` },
        { label: 'مصادر الدخل', value: money(sum(income.data || [])), tone: 'emerald' as Tone },
        { label: 'الأهداف المالية', value: String((goals.data || []).length), tone: 'violet' as Tone },
      ]),
    })
    const listRef = soon.length
      ? ctx.card({ type: 'list', title: 'الدفعات القادمة', total: soon.length, rows: soon.slice(0, 12).map((x) => ({ title: x.platform, subtitle: day(x.next_payment_date), meta: money(x.amount), badge: x.next_payment_date < today ? { label: 'متأخرة', tone: 'red' as Tone } : undefined, href: '/finances' })) })
      : null
    return {
      card: statsRef, list_card: listRef,
      due_soon: soon.slice(0, 30).map((x) => ({ platform: x.platform, amount: x.amount, date: x.next_payment_date, overdue: x.next_payment_date < today })),
      income: (income.data || []).slice(0, 30), goals: goals.data || [],
    }
  },
}

export const TEAM_TOOLS: AiTool[] = [myWork, teamTasks, goals, team, calendar, documents, prequal, audit, finances]
