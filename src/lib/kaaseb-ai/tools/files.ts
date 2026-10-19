// Company files — the "send me the CR and the profile" requests.
//
// Why two tools: names are bilingual and inconsistent ("Company Profile",
// "بروفايل الشركة", "السجل التجاري" vs "CR"). Literal text search misses them.
// So `company_files` hands the model the WHOLE (small) catalogue it may see,
// and the model — which understands both languages — picks ids. Then
// `prepare_downloads` turns exactly those ids into download buttons.

import { getOutreachTemplate } from '@/lib/outreach/store'
import { docsUnlocked } from '@/lib/docs/lock'
import { isAppOwnedUrl } from '@/lib/s3'
import { day, type Tone } from '../cards'
import type { AiTool, ToolCtx } from '../tool'

interface FileEntry {
  id: string
  name: string
  name_en?: string | null
  type: string
  url: string
  expiry?: string | null
}

async function catalogue(ctx: ToolCtx): Promise<{ files: FileEntry[]; notes: string[] }> {
  const files: FileEntry[] = []
  const notes: string[] = []
  const jobs: Promise<void>[] = []

  // The marketing profile attached to every outreach email — open to everyone.
  jobs.push((async () => {
    const t = await getOutreachTemplate().catch(() => null)
    if (t?.profileUrl && isAppOwnedUrl(t.profileUrl)) {
      files.push({ id: 'profile', name: 'بروفايل الشركة', name_en: t.profileName || 'Company Profile', type: 'بروفايل', url: t.profileUrl })
    }
  })())

  if (ctx.can('page.important_docs')) {
    jobs.push((async () => {
      if (!(await docsUnlocked())) { notes.push('المستندات المهمة مقفلة برمز — افتحها من صفحتها أولاً.'); return }
      const { data } = await ctx.supabase.from('important_documents').select('id, name_ar, name_en, file_url, expiry_date').limit(300)
      for (const d of data || []) {
        if (!d.file_url || !isAppOwnedUrl(d.file_url)) continue
        files.push({ id: `doc:${d.id}`, name: d.name_ar || d.name_en || 'مستند', name_en: d.name_en, type: 'مستند مهم', url: d.file_url, expiry: d.expiry_date })
      }
    })())
  }

  if (ctx.can('page.pre_qualifications')) {
    jobs.push((async () => {
      const { data } = await ctx.supabase.from('pre_qualifications').select('id, company_ar, company_en, project_name_ar, project_name_en, output_pdf_url').order('created_at', { ascending: false }).limit(100)
      for (const p of data || []) {
        if (!p.output_pdf_url || !isAppOwnedUrl(p.output_pdf_url)) continue
        const who = p.company_ar || p.company_en || ''
        const proj = p.project_name_ar || p.project_name_en || ''
        files.push({ id: `pq:${p.id}`, name: `تأهيل مسبق — ${[who, proj].filter(Boolean).join(' · ')}`, name_en: `Pre-qualification ${p.company_en || ''}`, type: 'تأهيل مسبق', url: p.output_pdf_url })
      }
    })())
  }

  await Promise.allSettled(jobs)
  return { files, notes }
}

const companyFiles: AiTool = {
  name: 'company_files',
  description: 'The full list of company files the user may download: company profile (بروفايل), important documents (السجل التجاري، الشهادات، الزكاة، التأمينات، الرخص…), and pre-qualification PDFs. Returns ids + names in Arabic/English. Match what the user asked for BY MEANING (any language, synonyms like CR = السجل التجاري), then call prepare_downloads with the ids.',
  parameters: { type: 'object', properties: {} },
  perms: [],
  status: 'يجمع ملفات الشركة…',
  async run(_args, ctx) {
    const { files, notes } = await catalogue(ctx)
    return {
      count: files.length,
      files: files.map((f) => ({ id: f.id, name: f.name, name_en: f.name_en || undefined, type: f.type, expiry: f.expiry || undefined })),
      notes,
    }
  },
}

const prepareDownloads: AiTool = {
  name: 'prepare_downloads',
  description: 'Build download buttons for the given company_files ids (one card, one button per file). Use whenever the user asks to send / give / download files.',
  parameters: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'string' }, description: 'ids from company_files.' } },
    required: ['ids'],
  },
  perms: [],
  status: 'يجهّز التحميل…',
  async run(args, ctx) {
    const want = Array.isArray(args.ids) ? args.ids.filter((x): x is string => typeof x === 'string').slice(0, 15) : []
    if (!want.length) return { error: 'ما حددت أي ملف.' }
    // Re-read the catalogue: an id is only honoured if THIS user can see it now.
    const { files } = await catalogue(ctx)
    const byId = new Map(files.map((f) => [f.id, f]))
    const picked = want.map((id) => byId.get(id)).filter((f): f is FileEntry => !!f)
    const missing = want.filter((id) => !byId.has(id))
    if (!picked.length) return { error: 'هذي الملفات غير متاحة لك.', missing }
    const today = new Date().toISOString().slice(0, 10)
    const ref = ctx.card({
      type: 'list',
      title: picked.length === 1 ? 'ملف جاهز للتحميل' : `${picked.length} ملفات جاهزة للتحميل`,
      rows: picked.map((f) => ({
        title: f.name,
        subtitle: [f.type, f.expiry ? `ينتهي ${day(f.expiry)}` : ''].filter(Boolean).join(' · '),
        badge: f.expiry && f.expiry < today ? { label: 'منتهي', tone: 'red' as Tone } : undefined,
        href: f.url,
        download: true,
      })),
    })
    return { card: ref, ready: picked.map((f) => f.name), missing }
  },
}

export const FILE_TOOLS: AiTool[] = [companyFiles, prepareDownloads]
