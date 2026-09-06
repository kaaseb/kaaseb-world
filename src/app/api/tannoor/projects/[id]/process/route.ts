// POST /api/tannoor/projects/[id]/process
//
// Tannoor now runs the SAME router pipeline as Furn (src/lib/boq/router/*),
// so both quotation engines read a BOQ with one brain:
//   1. Claim the project with an atomic lock, return 202 immediately.
//   2. In the background: read the BOQ alone → index every attachment
//      (content-hash cached) → route each row → read ONLY the routed pages
//      (quantities AND the thickness / finish / colour that decide the SKU)
//      → assemble with the drawings-override rule.
//   3. Match every line to a catalogue VARIANT deterministically (the shared
//      matcher — no invented products: a line that doesn't clear the bar is
//      is_missing and holds the project for a human, exactly as before).
//   4. The owner's two-tier scope rule: a clearly non-stone line (concrete,
//      terrazzo, porcelain…) is excluded and listed by name; a doubtful one
//      stays, flagged is_missing.
//   5. Wipe & repopulate tannoor_items; keep source + details in S3 maps;
//      advance stage/status exactly as the old single-call engine did.
//
// Progress lives in the same S3 blob the Furn run writes (keyed by project id),
// served by ./progress; the client polls the project until status leaves
// in_progress.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { setProjectItemSources } from '@/lib/tannoor/item-sources'
import { setProjectItemDetails } from '@/lib/tannoor/item-details'
import { guardItem, guardDepartmentAnchor, isClearlyOutOfScope } from '@/lib/boq/department-guard'
import { friendlyAiError } from '@/lib/ai/friendly-error'
import { getFxSettings, usdPrice } from '@/lib/settings/fx'
import { getColors } from '@/lib/tannoor/colors'
import { runBoqRouter, type RouterInput } from '@/lib/boq/router/pipeline'
import { thicknessFromText } from '@/lib/boq/router/core'
import { matchVariant, type CatalogVariant } from '@/lib/quotation/match'
import type { TannoorProduct } from '@/types'

export const maxDuration = 300

interface ProjectRow {
  id: string
  boq_url: string | null
  boq_filename: string | null
  spec_files: unknown
  drawing_files: unknown
  project_name_en: string | null
  project_name_ar: string | null
  company_en: string | null
  company_ar: string | null
  pricing_currency: string | null
}
interface DeptRow { id: string; name_en: string | null; name_ar: string | null }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const deny = await denyUnlessPermitted('tannoor.projects.create')
  if (deny) return deny

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project, error: pErr } = await supabase
    .from('tannoor_projects').select('*').eq('id', id).single()
  if (pErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.boq_url) return NextResponse.json({ error: 'No BOQ uploaded' }, { status: 400 })

  const [{ data: products }, { data: departments }] = await Promise.all([
    supabase.from('tannoor_products').select('*'),
    supabase.from('furn_departments').select('id, name_en, name_ar').eq('enabled', true),
  ])
  if (!products || products.length === 0) {
    return NextResponse.json({
      error: 'No products in catalog. Add products in Tannoor → Products first.',
    }, { status: 400 })
  }
  const depts = (departments || []) as DeptRow[]
  const coveredDepartments = depts.map((d) => ({ name_en: d.name_en || '', name_ar: d.name_ar || '' }))
  if (coveredDepartments.length === 0) {
    return NextResponse.json({ error: 'No covered departments enabled. Enable departments in Furn Settings first.' }, { status: 400 })
  }

  // Atomic compare-and-set lock — the twin of the Furn process route. A live
  // run is status='in_progress'; a stale one (crash/deploy) frees in minutes
  // thanks to the heartbeat below.
  const STALE_LOCK_MS = 5 * 60 * 1000
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const { data: locked } = await supabase.from('tannoor_projects')
    .update({ status: 'in_progress', ai_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .or(`status.neq.in_progress,updated_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()
  if (!locked) {
    return NextResponse.json(
      { error: 'المشروع قيد المعالجة فعلاً الآن — انتظر دقيقة لين تخلص، أو أعد المحاولة.' },
      { status: 409 },
    )
  }

  const p = project as ProjectRow
  const input: RouterInput = {
    projectId: id,
    boqUrl: p.boq_url,
    boqFilename: p.boq_filename || 'BOQ',
    specFiles: Array.isArray(p.spec_files) ? p.spec_files : [],
    drawingFiles: Array.isArray(p.drawing_files) ? p.drawing_files : [],
    otherFiles: [],
    coveredDepartments,
    projectName: p.project_name_en || p.project_name_ar || 'Project',
    companyName: p.company_en || p.company_ar || 'Company',
  }

  // Fire-and-forget — the Node server keeps the promise alive after the
  // response returns (VM deployment). The client polls.
  void runTannoorJob(supabase, p, input, products as TannoorProduct[], depts).catch(() => {})

  return NextResponse.json({ started: true }, { status: 202 })
}

// ─── the background job ─────────────────────────────────────────────────────

async function runTannoorJob(
  supabase: SupabaseClient,
  project: ProjectRow,
  input: RouterInput,
  products: TannoorProduct[],
  departments: DeptRow[],
): Promise<void> {
  const id = project.id
  const coveredNames = departments.flatMap((d) => [d.name_en, d.name_ar]).filter((n): n is string => !!n)

  let alive = true
  const heartbeat = setInterval(() => {
    if (!alive) return
    void supabase.from('tannoor_projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'in_progress')
      .then(() => {}, () => {})
  }, 30_000)
  const stopHeartbeat = () => { alive = false; clearInterval(heartbeat) }

  try {
    const result = await runBoqRouter(input)
    stopHeartbeat()

    // ── Catalogue as VARIANTS (colours / finish / thickness live in S3) ──────
    const [colours, fx] = await Promise.all([getColors(), getFxSettings()])
    const projectCurrency: 'SAR' | 'USD' = project.pricing_currency === 'USD' ? 'USD' : 'SAR'
    const deptName = new Map(departments.map((d) => [d.id, d.name_en || d.name_ar || '']))
    const catalog: CatalogVariant[] = products.map((pr) => ({
      id: pr.id,
      name: [pr.name_en, pr.name_ar].filter(Boolean).join(' '),
      colours: Array.from(new Set([...(colours.byProduct[pr.id] || []), pr.color_en || '', pr.color_ar || ''].filter(Boolean))),
      finish: colours.attrs[pr.id]?.finish ?? pr.finish ?? null,
      thickness_mm: colours.attrs[pr.id]?.thickness_mm ?? (pr.thickness_mm == null ? null : Number(pr.thickness_mm)),
      unit: pr.unit,
      price_sar: Number(pr.price_sar) || 0,
      price_usd: Number(pr.price_usd) || 0,
      department: pr.department_id ? deptName.get(pr.department_id) || null : null,
    }))
    const productMap = new Map(products.map((pr) => [pr.id, pr]))

    // ── Scope + match every extracted line ──────────────────────────────────
    const dropped: Array<{ description: string; department: string }> = []
    const extraDepartments = new Set<string>(result.detected_departments)
    const missingItems: Array<{ description: string; reason: string }> = []
    type Line = (typeof result.items)[number] & { product_id: string | null; is_missing: boolean; matchReason: string }
    const lines: Line[] = []

    for (const it of result.items) {
      const text = `${it.description || ''} ${it.details || ''}`
      // Owner's rule: clearly non-stone → out of the table, listed by name.
      if (isClearlyOutOfScope(text, it.department_match, coveredNames)) {
        const v = guardItem(text, it.department_match, coveredNames)
        if (v.realDepartment) extraDepartments.add(v.realDepartment)
        dropped.push({ description: it.description, department: v.realDepartment || '—' })
        continue
      }
      const verdict = guardItem(text, it.department_match, coveredNames)
      const problem = verdict.disqualified ? verdict : guardDepartmentAnchor(text, coveredNames, it.department_match)
      const doubtful = problem.disqualified
      // Doubtful lines are never auto-priced — is_missing puts them in front of a human.
      const match = doubtful
        ? null
        : matchVariant(text, { thickness_mm: thicknessFromText(it.details) ?? thicknessFromText(it.description) }, catalog)
      const noQty = !(it.quantity > 0)
      if (!match) {
        missingItems.push({
          description: it.description,
          reason: doubtful
            ? (problem.reason || 'مادة غير مؤكدة — راجعها')
            : 'لا يوجد منتج مطابق بثقة في الكتالوج (الاسم/اللون/الفنش/السماكة) — أضِفه في المنتجات أو اربطه يدوياً',
        })
      } else if (noQty) {
        missingItems.push({ description: it.description, reason: 'بلا كمية موثّقة — راجع المصدر' })
      }
      lines.push({ ...it, product_id: match?.product_id ?? null, is_missing: !match || noQty, matchReason: match ? match.reasons.join(' · ') : '' })
    }
    if (dropped.length > 0) {
      console.log(`[tannoor] dropped ${dropped.length} clearly-out-of-scope item(s) in project ${id}:`)
      for (const d of dropped) console.log(`  ⛔ "${d.description}" — ${d.department}`)
    }

    // ── Persist: wipe & repopulate (only now — the risky work is done) ──────
    await supabase.from('tannoor_items').delete().eq('project_id', id)
    const sourceMap: Record<string, string> = {}
    const detailsMap: Record<string, string> = {}

    if (lines.length > 0) {
      const rows = lines.map((ln, idx) => {
        const product = ln.product_id ? productMap.get(ln.product_id) : null
        return {
          project_id: id,
          position: idx + 1,
          description: ln.description,
          quantity: ln.quantity,
          // KEEP THE CUSTOMER'S UNIT (AGENTS.md: never silently convert units).
          unit: ln.unit || product?.unit || '',
          product_id: ln.product_id,
          // Seed the price in the PROJECT's currency; a rate mode derives USD
          // from SAR so the drift-prone price_usd column stops mattering.
          unit_price: product
            ? (projectCurrency === 'USD' ? usdPrice(fx, product.price_sar, product.price_usd) : (product.price_sar ?? null))
            : null,
          currency: projectCurrency,
          // `notes` is the TEAM's column — never written by the AI.
          notes: null,
          is_missing: ln.is_missing,
          ai_confidence: ln.ai_confidence,
        }
      })
      const { data: inserted, error: insErr } = await supabase
        .from('tannoor_items').insert(rows).select('id, position')
      if (insErr) throw new Error(`Failed to persist items: ${insErr.message}`)

      const byPos = new Map(lines.map((ln, idx) => [idx + 1, ln]))
      for (const r of inserted || []) {
        const ln = byPos.get(r.position as number)
        if (!ln) continue
        const src = [ln.source || '', ln.matchReason ? `مطابقة الكتالوج: ${ln.matchReason}` : ''].filter(Boolean).join(' — ')
        if (src) sourceMap[r.id as string] = src
        if (ln.details) detailsMap[r.id as string] = ln.details
      }
    }
    await setProjectItemSources(id, sourceMap)
    await setProjectItemDetails(id, detailsMap)

    // A zero-quantity or unmatched line is NOT ready to quote — Tannoor
    // auto-completes with no human gate, so it must hold the project back.
    const hasMissing = lines.some((ln) => ln.is_missing) || missingItems.length > 0
    const droppedNote = dropped.length > 0
      ? `⛔ استُبعد ${dropped.length} بند واضح خارج النطاق (${Array.from(new Set(dropped.map((d) => d.department))).join('، ')}): ${dropped.slice(0, 10).map((d) => d.description).join('؛ ')}${dropped.length > 10 ? ` … و${dropped.length - 10} غيرها` : ''}`
      : null
    const departmentsOut = Array.from(
      new Map(Array.from(extraDepartments).map((d) => (d || '').trim()).filter(Boolean).map((d) => [d.toLowerCase(), d])).values(),
    )

    await supabase.from('tannoor_projects').update({
      subject: result.subject,
      ai_summary: [droppedNote, result.notes].filter(Boolean).join('\n'),
      ai_detected_departments: departmentsOut,
      ai_missing_items: missingItems,
      ai_error: null,
      stage: hasMissing ? 'processing' : 'quoted',
      status: hasMissing ? 'missing_products' : 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    console.log(
      `[tannoor] router done for ${id}: ${lines.length} items (${lines.filter((l) => l.is_missing).length} missing, ${dropped.length} dropped), ` +
      `${result.coverage.rowsResolved} resolved, ${result.coverage.pagesRead} pages read`,
    )
  } catch (e) {
    stopHeartbeat()
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[tannoor] router FAILED for ${id}: ${msg}`)
    // status='rejected' also frees the lock so a retry works immediately.
    await supabase.from('tannoor_projects').update({
      status: 'rejected',
      ai_error: friendlyAiError(msg).slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  } finally {
    stopHeartbeat()
  }
}
