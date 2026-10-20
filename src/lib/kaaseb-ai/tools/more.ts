// The rest of Kaaseb World: Tannoor detail + catalogue, project team chats,
// departments + their files, ideas, points, approvals, Magic Tunnel renders,
// quotation defaults, and (super admin) who-can-do-what.

import { getProjectConversationId } from '@/lib/project-chats/store'
import { listJobs } from '@/lib/visualize/jobs'
import { getFurnSettings } from '@/lib/furn/settings-store'
import { DEFAULT_PERMISSIONS, PERMISSION_MODULES } from '@/lib/permissions'
import { isAppOwnedUrl } from '@/lib/s3'
import { action, compact, day, money, type Tone } from '../cards'
import { type AiTool, str, int, matches } from '../tool'

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

// ── Tannoor ──────────────────────────────────────────────────────────────────
const tannoorGet: AiTool = {
  name: 'tannoor_project_get',
  description: 'Open ONE Tannoor project by number or id: its items with the matched catalogue product and price, missing products, notes, and its quotations.',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, id: { type: 'string' } } },
  perms: ['page.tannoor'],
  status: 'يفتح مشروع التنّور…',
  async run(args, ctx) {
    const id = str(args.id, 80)
    const num = int(args.number, 0, 0, 10_000_000)
    if (!id && !num) return { error: 'حدد رقم المشروع.' }
    let q = ctx.supabase.from('tannoor_projects').select('*')
    q = id ? q.eq('id', id) : q.eq('project_number', num)
    const { data: p } = await q.maybeSingle()
    if (!p) return { error: 'ما لقيت مشروع تنّور بهذا الرقم.' }
    const [{ data: items }, { data: quotes }] = await Promise.all([
      ctx.supabase.from('tannoor_items').select('*, tannoor_products(id, name_en, name_ar, unit, price_sar, price_usd, availability)').eq('project_id', p.id).order('position').limit(500),
      ctx.supabase.from('tannoor_quotations').select('*').eq('project_id', p.id).order('generated_at', { ascending: false }).limit(5),
    ])
    const its = items || []
    const missing = its.filter((i) => i.is_missing).length
    const latest = (quotes || [])[0]
    const ref = ctx.card({
      type: 'record',
      kind: `مشروع تنّور #${p.project_number}`,
      title: p.project_name_ar || p.project_name_en || '—',
      subtitle: [p.company_ar || p.company_en, p.engineer_name_ar || p.engineer_name_en].filter(Boolean).join(' · ') || undefined,
      badge: missing ? { label: `${missing} منتج ناقص`, tone: 'red' } : p.stage === 'quoted' ? { label: 'تم التسعير', tone: 'emerald' } : { label: 'قيد المعالجة', tone: 'amber' },
      amount: latest ? money(latest.total, latest.currency || 'SAR') : undefined,
      fields: [{ label: 'البنود', value: String(its.length) }, { label: 'عروض صادرة', value: String((quotes || []).length) }, { label: 'التاريخ', value: day(p.created_at) }],
      actions: compact([
        latest ? action('download', 'تحميل العرض PDF', `/print/tannoor-quotation/${p.id}/${latest.id}`, true) : null,
        action('edit', 'تعديل', `/tannoor/${p.id}`),
      ]),
    })
    return {
      card: ref, number: p.project_number, name: p.project_name_ar || p.project_name_en, company: p.company_ar || p.company_en,
      stage: p.stage, status: p.status, summary: p.ai_summary ? String(p.ai_summary).slice(0, 600) : null, missing_products: missing,
      items: its.slice(0, 150).map((i, n) => {
        const prod = one(i.tannoor_products as unknown) as { name_ar?: string; name_en?: string; price_sar?: number } | null
        return { n: n + 1, description: i.description, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, currency: i.currency, product: prod ? (prod.name_ar || prod.name_en) : null, missing: i.is_missing, notes: i.notes || undefined }
      }),
      quotations: (quotes || []).map((x) => ({ number: x.quotation_number, total: x.total, currency: x.currency, date: String(x.generated_at || '').slice(0, 10) })),
    }
  },
}

const products: AiTool = {
  name: 'catalogue_products',
  description: 'The materials catalogue (منتجات التنّور — marble & granite products) with prices in SAR/USD and availability. Search by name.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: '1-30, default 12.' } } },
  perms: ['page.tannoor_products'],
  status: 'يبحث في المنتجات…',
  async run(args, ctx) {
    const { data, error } = await ctx.supabase.from('tannoor_products').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) return { error: error.message }
    const q = str(args.query)
    const rows = (data || []).filter((p) => !q || matches(q, p.name_ar, p.name_en, p.description_ar, p.description_en))
    const limit = int(args.limit, 12, 1, 30)
    const AV: Record<string, { label: string; tone: Tone }> = { high: { label: 'متوفر', tone: 'emerald' }, medium: { label: 'متوسط', tone: 'amber' }, low: { label: 'قليل', tone: 'amber' }, out_of_stock: { label: 'نافد', tone: 'red' } }
    const ref = rows.length
      ? ctx.card({ type: 'list', title: 'المنتجات', total: rows.length, rows: rows.slice(0, limit).map((p) => ({ title: p.name_ar || p.name_en, subtitle: p.unit || undefined, meta: p.price_sar != null ? money(p.price_sar) : undefined, badge: p.availability ? AV[p.availability] : undefined, href: '/tannoor/products' })) })
      : null
    return { card: ref, count: rows.length, products: rows.slice(0, 40).map((p) => ({ name: p.name_ar || p.name_en, name_en: p.name_en, unit: p.unit, price_sar: p.price_sar, price_usd: p.price_usd, availability: p.availability })) }
  },
}

// ── project team chat ────────────────────────────────────────────────────────
const projectChat: AiTool = {
  name: 'project_chat',
  description: 'Recent messages of a client project\'s team chat (دردشة المشروع) — what the team said about it. Needs the project number or id.',
  parameters: { type: 'object', properties: { number: { type: 'integer' }, id: { type: 'string' }, limit: { type: 'integer', description: '1-60, default 30.' } } },
  perms: ['page.client_projects'],
  status: 'يقرأ دردشة المشروع…',
  async run(args, ctx) {
    const id = str(args.id, 80)
    const num = int(args.number, 0, 0, 10_000_000)
    let q = ctx.supabase.from('client_projects').select('id, project_number, name_ar, name_en')
    q = id ? q.eq('id', id) : q.eq('project_number', num)
    const { data: p } = await q.maybeSingle()
    if (!p) return { error: 'ما لقيت المشروع.' }
    const convId = await getProjectConversationId(p.id)
    if (!convId) return { count: 0, messages: [], note: 'ما فيه دردشة لهذا المشروع بعد.' }
    const limit = int(args.limit, 30, 1, 60)
    // The user's own client: RLS decides whether they may read this chat.
    const { data: msgs } = await ctx.supabase.from('chat_messages').select('*').eq('conversation_id', convId).is('deleted_at', null).order('created_at', { ascending: false }).limit(limit)
    const ids = [...new Set((msgs || []).map((m) => m.sender_id).filter(Boolean))]
    const { data: people } = ids.length ? await ctx.supabase.from('profiles').select('id, full_name').in('id', ids) : { data: [] as Array<{ id: string; full_name: string | null }> }
    const name = new Map((people || []).map((x) => [x.id, x.full_name || '—']))
    const list = (msgs || []).reverse()
    return {
      project: `#${p.project_number} · ${p.name_ar || p.name_en}`, count: list.length,
      messages: list.map((m) => ({ from: name.get(m.sender_id) || '—', at: String(m.created_at).slice(0, 16), text: String(m.content || (m.media_type ? `[${m.media_type}]` : '')).slice(0, 500) })),
    }
  },
}

// ── departments ──────────────────────────────────────────────────────────────
const departments: AiTool = {
  name: 'departments',
  description: 'Departments with their members and uploaded department files (with download buttons). Non-admins see only the departments they belong to.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Department name (optional).' } } },
  perms: ['page.departments'],
  status: 'يراجع الأقسام…',
  async run(args, ctx) {
    const admin = ctx.profile.role === 'super_admin'
    let allowedIds: string[] | null = null
    if (!admin) {
      const { data: mine } = await ctx.supabase.from('department_members').select('department_id').eq('user_id', ctx.user.id)
      allowedIds = (mine || []).map((m) => m.department_id as string)
      if (!allowedIds.length) return { count: 0, departments: [], note: 'ما أنت عضو في أي قسم.' }
    }
    let q = ctx.supabase.from('departments').select('id, name, department_members(user_id, profiles(full_name))').order('name')
    if (allowedIds) q = q.in('id', allowedIds)
    const { data, error } = await q
    if (error) return { error: error.message }
    const text = str(args.query)
    const depts = (data || []).filter((d) => !text || matches(text, d.name))
    const ids = depts.map((d) => d.id)
    const { data: files } = ids.length ? await ctx.supabase.from('department_files').select('*').in('department_id', ids).order('created_at', { ascending: false }).limit(200) : { data: [] as Array<Record<string, unknown>> }
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
    const fileUrl = (path: string) => {
      const { data: u } = ctx.supabase.storage.from('department-files').getPublicUrl(path)
      return base && u.publicUrl.startsWith(`${base}/`) ? u.publicUrl : null
    }
    const rows = (files || []).slice(0, 15).map((f) => ({
      title: String(f.name || 'ملف'), subtitle: `${depts.find((d) => d.id === f.department_id)?.name || ''} · ${day(String(f.created_at || ''))}`,
      href: fileUrl(String(f.file_path || '')) || `/departments/${f.department_id}`, download: true,
    }))
    const ref = rows.length ? ctx.card({ type: 'list', title: 'ملفات الأقسام', total: (files || []).length, rows }) : null
    return {
      card: ref,
      departments: depts.map((d) => ({
        name: d.name,
        members: ((d.department_members || []) as Array<{ profiles?: unknown }>).map((m) => (one(m.profiles) as { full_name?: string } | null)?.full_name).filter(Boolean),
        files: (files || []).filter((f) => f.department_id === d.id).map((f) => String(f.name)),
      })),
    }
  },
}

// ── ideas, points, approvals ─────────────────────────────────────────────────
const ideas: AiTool = {
  name: 'ideas',
  description: 'The ideas market (الأفكار): proposed / implemented / rejected ideas, who proposed them, reward points.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string', enum: ['proposed', 'implemented', 'rejected'] } } },
  perms: ['page.idea_market'],
  status: 'يراجع الأفكار…',
  async run(args, ctx) {
    let q = ctx.supabase.from('ideas').select('*, profiles:created_by(full_name), departments(name)').order('created_at', { ascending: false }).limit(100)
    if (str(args.status)) q = q.eq('status', str(args.status))
    const { data, error } = await q
    if (error) return { error: error.message }
    const text = str(args.query)
    const rows = (data || []).filter((i) => !text || matches(text, i.title, i.description, i.category))
    const ST: Record<string, { label: string; tone: Tone }> = { proposed: { label: 'مقترحة', tone: 'blue' }, implemented: { label: 'منفّذة', tone: 'emerald' }, rejected: { label: 'مرفوضة', tone: 'red' } }
    const ref = rows.length ? ctx.card({ type: 'list', title: 'الأفكار', total: rows.length, rows: rows.slice(0, 12).map((i) => ({ title: i.title, subtitle: (one(i.profiles) as { full_name?: string } | null)?.full_name || undefined, badge: ST[i.status], href: '/ideas' })) }) : null
    return { card: ref, ideas: rows.slice(0, 30).map((i) => ({ title: i.title, status: i.status, by: (one(i.profiles) as { full_name?: string } | null)?.full_name, reward: i.reward_points, description: String(i.description || '').slice(0, 200) })) }
  },
}

const points: AiTool = {
  name: 'points',
  description: 'Points leaderboard and the current user\'s own points.',
  parameters: { type: 'object', properties: { limit: { type: 'integer', description: '1-30, default 10.' } } },
  perms: [],
  status: 'يراجع النقاط…',
  async run(args, ctx) {
    const limit = int(args.limit, 10, 1, 30)
    const { data } = await ctx.supabase.from('profiles').select('id, full_name, total_points').order('total_points', { ascending: false }).limit(200)
    const all = data || []
    const rank = all.findIndex((p) => p.id === ctx.user.id)
    const ref = all.length ? ctx.card({ type: 'list', title: 'ترتيب النقاط', rows: all.slice(0, limit).map((p, i) => ({ title: `${i + 1}. ${p.full_name || '—'}`, meta: String(p.total_points ?? 0), badge: p.id === ctx.user.id ? { label: 'أنت', tone: 'blue' as Tone } : undefined })) }) : null
    return { card: ref, my_points: ctx.profile.total_points ?? 0, my_rank: rank >= 0 ? rank + 1 : null, top: all.slice(0, limit).map((p) => ({ name: p.full_name, points: p.total_points })) }
  },
}

const approvals: AiTool = {
  name: 'pending_approvals',
  description: 'Points waiting for the super admin\'s approval (الاعتمادات). Super admin only.',
  parameters: { type: 'object', properties: {} },
  perms: [],
  adminOnly: true,
  status: 'يراجع الاعتمادات…',
  async run(_args, ctx) {
    const { data, error } = await ctx.supabase.from('pending_points').select('user_name, user_email, action_type, object_type, object_name, points, status, created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
    if (error) return { error: error.message }
    const rows = data || []
    const ref = rows.length ? ctx.card({ type: 'list', title: 'بانتظار الاعتماد', total: rows.length, rows: rows.slice(0, 12).map((r) => ({ title: r.object_name || r.object_type, subtitle: [r.user_name || r.user_email, r.action_type].filter(Boolean).join(' · '), meta: `+${r.points}`, href: '/approvals' })) }) : null
    return { card: ref, count: rows.length, pending: rows.slice(0, 40) }
  },
}

// ── Magic Tunnel ─────────────────────────────────────────────────────────────
const renders: AiTool = {
  name: 'magic_tunnel_renders',
  description: 'Magic Tunnel (النفق السحري) renders: product-on-scene visualisations, with the result images.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: '1-15, default 8.' } } },
  perms: ['page.visualize'],
  status: 'يراجع النفق السحري…',
  async run(args, ctx) {
    const q = str(args.query)
    const jobs = (await listJobs()).filter((j) => !q || matches(q, j.productName, j.notes, j.createdByName))
    const limit = int(args.limit, 8, 1, 15)
    const ST: Record<string, { label: string; tone: Tone }> = { done: { label: 'جاهز', tone: 'emerald' }, processing: { label: 'يُرسم', tone: 'amber' }, failed: { label: 'فشل', tone: 'red' } }
    const ref = jobs.length ? ctx.card({ type: 'list', title: 'النفق السحري', total: jobs.length, rows: jobs.slice(0, limit).map((j) => ({ title: j.productName || 'تصوّر', subtitle: [j.createdByName, day(j.createdAt)].filter(Boolean).join(' · '), badge: ST[j.status], href: j.resultUrl && isAppOwnedUrl(j.resultUrl) ? j.resultUrl : '/visualize' })) }) : null
    return { card: ref, count: jobs.length, renders: jobs.slice(0, limit).map((j) => ({ product: j.productName, status: j.status, by: j.createdByName, date: j.createdAt.slice(0, 10), notes: j.notes?.slice(0, 160) })) }
  },
}

// ── quotation defaults ───────────────────────────────────────────────────────
const quoteSettings: AiTool = {
  name: 'quotation_defaults',
  description: 'Company quotation settings: default payment / delivery terms, offer validity, special conditions, company phone/email, CR and VAT numbers, next quotation number.',
  parameters: { type: 'object', properties: {} },
  perms: ['page.furn'],
  status: 'يقرأ إعدادات العروض…',
  async run(_args, ctx) {
    const s = await getFurnSettings(ctx.supabase)
    return {
      payment_terms: s.default_payment_terms, delivery_terms: s.default_delivery_terms, offer_duration: s.default_offer_duration,
      special_conditions: s.default_special_conditions, manager: s.manager_name, phone: s.company_phone, email: s.company_email,
      commercial_register: s.commercial_register, tax_number: s.tax_number, address: s.footer_address, next_quotation_number: s.next_quotation_number,
    }
  },
}

// ── who can do what (super admin) ────────────────────────────────────────────
const access: AiTool = {
  name: 'team_access',
  description: 'Who has access to which section (الصلاحيات): per employee, the sections they can read and edit. Super admin only.',
  parameters: { type: 'object', properties: { employee: { type: 'string' }, section: { type: 'string', description: 'Section name, e.g. الفرن' } } },
  perms: [],
  adminOnly: true,
  status: 'يراجع الصلاحيات…',
  async run(args, ctx) {
    const [{ data: people }, { data: roles }] = await Promise.all([
      ctx.supabase.from('profiles').select('id, full_name, email, role, custom_role_id').limit(500),
      ctx.supabase.from('custom_roles').select('id, name, permissions'),
    ])
    const roleById = new Map((roles || []).map((r) => [r.id, r]))
    const who = str(args.employee)
    const sec = str(args.section)
    const out = (people || []).filter((p) => !who || matches(who, p.full_name, p.email)).map((p) => {
      const cr = p.custom_role_id ? roleById.get(p.custom_role_id) : null
      const perms: string[] = p.role === 'super_admin' ? ['*'] : (cr?.permissions as string[]) || DEFAULT_PERMISSIONS[p.role as keyof typeof DEFAULT_PERMISSIONS] || []
      const has = (k: string) => perms.includes('*') || perms.includes(k)
      const read = PERMISSION_MODULES.filter((m) => has(m.read)).map((m) => m.ar)
      const write = PERMISSION_MODULES.filter((m) => m.write.length && m.write.every(has)).map((m) => m.ar)
      return { name: p.full_name || p.email, role: p.role === 'super_admin' ? 'مدير عام' : cr?.name || p.role, read, write }
    }).filter((x) => !sec || x.read.some((r) => matches(sec, r)))
    const ref = out.length ? ctx.card({ type: 'list', title: sec ? `مين يوصل لـ ${sec}` : 'الصلاحيات', total: out.length, rows: out.slice(0, 15).map((x) => ({ title: x.name, subtitle: x.read.slice(0, 6).join('، ') + (x.read.length > 6 ? '…' : ''), badge: { label: x.role, tone: 'slate' as Tone }, href: '/roles' })) }) : null
    return { card: ref, count: out.length, people: out.slice(0, 60) }
  },
}

export const MORE_TOOLS: AiTool[] = [tannoorGet, products, projectChat, departments, ideas, points, approvals, renders, quoteSettings, access]
