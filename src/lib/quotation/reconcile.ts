// Quotation-row reconciliation shared by Furn and Tannoor.
//
// "Re-issue REPLACES, never duplicates." A project owns exactly one quotation
// number, and at most one row per language under it. This helper makes that
// true regardless of the database's unique indexes (the composite index the old
// upsert relied on lives in a migration that was never run) and regardless of
// how many duplicate rows an older code path left behind:
//
//   1. read every row the project has
//   2. keep the earliest row per language, delete the rest (legacy duplicates)
//   3. reuse the smallest number already issued, else allocate a fresh one
//   4. for each language being (re)written: update the kept row or insert one
//
// Rows of languages NOT being written this call are kept untouched (Tannoor
// generates one language at a time; regenerating AR must not lose EN).

import type { SupabaseClient } from '@supabase/supabase-js'

export type QuoteLang = 'ar' | 'en'

export interface ReconcileArgs {
  db: SupabaseClient
  table: 'furn_quotations' | 'tannoor_quotations'
  projectId: string
  /** Languages to (re)write in this call. */
  writeLanguages: QuoteLang[]
  /** Allocate a fresh quotation number when the project has none yet. */
  allocate: () => Promise<number>
  /** Column values for one language — everything except id / project_id /
   *  quotation_number / language, which the helper sets. */
  build: (lang: QuoteLang, quotationNumber: number) => Record<string, unknown>
}

export interface ReconciledRow {
  id: string
  language: QuoteLang
  quotation_number: number
  [k: string]: unknown
}

export interface ReconcileResult {
  rows: ReconciledRow[]
  quotationNumber: number
  deleted: number
}

export async function reconcileQuotationRows(args: ReconcileArgs): Promise<ReconcileResult> {
  const { db, table, projectId, writeLanguages, allocate, build } = args

  const { data: existingRows, error: readErr } = await db
    .from(table)
    .select('id, quotation_number, language')
    .eq('project_id', projectId)
    .order('quotation_number', { ascending: true })
  if (readErr) throw new Error(readErr.message)
  const existing = (existingRows || []) as Array<{ id: string; quotation_number: number; language: QuoteLang }>

  // Earliest row per language survives; everything else is a duplicate.
  const keepId = new Map<QuoteLang, string>()
  for (const r of existing) if (!keepId.has(r.language)) keepId.set(r.language, r.id)
  const keptIds = new Set(keepId.values())
  const staleIds = existing.filter((r) => !keptIds.has(r.id)).map((r) => r.id)
  if (staleIds.length > 0) {
    const { error } = await db.from(table).delete().in('id', staleIds)
    if (error) throw new Error(error.message)
  }

  const quotationNumber = existing.length > 0
    ? Math.min(...existing.map((r) => r.quotation_number))
    : await allocate()

  // Kept rows of languages we are NOT rewriting still get the shared number so
  // the AR/EN pair never shows two different identifiers.
  for (const r of existing) {
    if (keptIds.has(r.id) && !writeLanguages.includes(r.language) && r.quotation_number !== quotationNumber) {
      const { error } = await db.from(table).update({ quotation_number: quotationNumber }).eq('id', r.id)
      if (error) throw new Error(error.message)
    }
  }

  const rows: ReconciledRow[] = []
  for (const lang of writeLanguages) {
    const values = { ...build(lang, quotationNumber), project_id: projectId, quotation_number: quotationNumber, language: lang }
    const id = keepId.get(lang)
    const q = id
      ? await db.from(table).update(values).eq('id', id).select('*').single()
      : await db.from(table).insert(values).select('*').single()
    if (q.error || !q.data) throw new Error(q.error?.message || 'Failed to save quotation row')
    rows.push(q.data as ReconciledRow)
  }
  return { rows, quotationNumber, deleted: staleIds.length }
}
