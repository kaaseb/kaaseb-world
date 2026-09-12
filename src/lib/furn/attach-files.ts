// Attach app-owned files to an EXISTING Furn project's buckets — used by the
// manual "add files" route and the "fetch from link" route, so both behave
// identically:
//   • BOQ files live in the S3 extras store (many files; the row keeps the first
//     as boq_url for older readers).
//   • Real BOQs arriving push the intake's email-body ".txt" placeholder out of
//     the BOQ bucket into "other", so the AI reads the bill, not the email.
//   • Per-bucket dedupe by URL, capped.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getFurnExtras, resolveBoqFiles, setFurnExtras, type FurnBoqFile } from '@/lib/furn/project-extras'
import { isEmailBodyPlaceholder, bucketForFile } from '@/lib/links/discover'

export type Bucket = 'boq' | 'spec' | 'drawing' | 'other'
export const BUCKETS: Bucket[] = ['boq', 'spec', 'drawing', 'other']
const BUCKET_CAP = 250

export interface AttachResult {
  project: Record<string, unknown>
  boqFiles: FurnBoqFile[]
  added: Record<Bucket, number>
  demoted: number
}

/** Split a flat file list into buckets by name (Excel → BOQ, PDF → specs …). */
export function groupByName(files: FurnBoqFile[]): Record<Bucket, FurnBoqFile[]> {
  const g: Record<Bucket, FurnBoqFile[]> = { boq: [], spec: [], drawing: [], other: [] }
  for (const f of files) g[bucketForFile(f.name)].push(f)
  return g
}

export async function attachFilesToFurnProject(
  supabase: SupabaseClient,
  id: string,
  groups: Partial<Record<Bucket, FurnBoqFile[]>>,
): Promise<AttachResult | { error: string; status: number }> {
  const { data: project } = await supabase
    .from('furn_projects')
    .select('id, boq_url, boq_filename, spec_files, drawing_files, other_files')
    .eq('id', id).maybeSingle()
  if (!project) return { error: 'Project not found', status: 404 }

  const extras = await getFurnExtras(id)
  const listOf = (v: unknown): FurnBoqFile[] => (Array.isArray(v) ? v : []).filter((x) => x && typeof x.url === 'string')
  const dedupe = (list: FurnBoqFile[]) => {
    const seen = new Set<string>()
    return list.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true))).slice(0, BUCKET_CAP)
  }

  let boqFiles = resolveBoqFiles(project, extras)
  const cur: Record<Bucket, FurnBoqFile[]> = {
    boq: boqFiles, spec: listOf(project.spec_files), drawing: listOf(project.drawing_files), other: listOf(project.other_files),
  }
  const added: Record<Bucket, number> = { boq: 0, spec: 0, drawing: 0, other: 0 }
  let demoted = 0
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  const incomingBoq = groups.boq || []
  if (incomingBoq.length > 0) {
    const placeholders = boqFiles.filter((f) => isEmailBodyPlaceholder(f.name))
    if (placeholders.length > 0) {
      boqFiles = boqFiles.filter((f) => !isEmailBodyPlaceholder(f.name))
      cur.other = dedupe([...cur.other, ...placeholders])
      demoted = placeholders.length
      patch.other_files = cur.other
    }
    const before = boqFiles.length
    boqFiles = dedupe([...boqFiles, ...incomingBoq])
    added.boq = boqFiles.length - before
    cur.boq = boqFiles
    patch.boq_url = boqFiles[0]?.url ?? null
    patch.boq_filename = boqFiles[0]?.name ?? null
  }
  for (const b of ['spec', 'drawing', 'other'] as const) {
    const inc = groups[b] || []
    if (inc.length === 0) continue
    const before = cur[b].length
    cur[b] = dedupe([...cur[b], ...inc])
    added[b] = cur[b].length - before
    patch[`${b}_files`] = cur[b]
  }

  if (incomingBoq.length > 0) {
    try { await setFurnExtras(id, { boqFiles }) } catch (e) {
      return { error: `فشل حفظ ملفات الـBOQ — ${e instanceof Error ? e.message : 'حاول مرة أخرى'}`, status: 500 }
    }
  }
  const { data, error } = await supabase.from('furn_projects').update(patch).eq('id', id).select('*').single()
  if (error) return { error: error.message, status: 500 }
  return { project: data as Record<string, unknown>, boqFiles, added, demoted }
}
