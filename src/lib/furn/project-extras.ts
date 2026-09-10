// Furn project EXTRAS — what the furn_projects row cannot hold (no migrations):
//   • ALL the BOQ files (the row has a single boq_url; a real client project
//     ships several packages — "ALL PACKAGES COMBINED" + one file per trade).
//   • the client project's notes + keywords, imported verbatim.
// Kept in one S3 blob keyed by project id, written atomically (mutateJson) so
// two projects created at the same moment never overwrite each other's entry.
// boq_url / boq_filename on the row stay = the FIRST BOQ for backward compat.

import { readJson, mutateJson } from '@/lib/s3'

const KEY = 'app-data/furn-project-extras.json'

export interface FurnBoqFile { url: string; name: string }

export interface FurnProjectExtras {
  boqFiles: FurnBoqFile[]
  notes: string | null
  keywords: string | null
  /** client_projects.id this project was imported from (audit). */
  importedFrom: string | null
}

type Store = Record<string, Partial<FurnProjectExtras>>

const EMPTY: FurnProjectExtras = { boqFiles: [], notes: null, keywords: null, importedFrom: null }

function clean(e: Partial<FurnProjectExtras> | undefined): FurnProjectExtras {
  return {
    boqFiles: Array.isArray(e?.boqFiles)
      ? e!.boqFiles.filter((f) => f && typeof f.url === 'string' && f.url).map((f) => ({ url: f.url, name: String(f.name || 'BOQ').slice(0, 200) }))
      : [],
    notes: typeof e?.notes === 'string' && e.notes.trim() ? e.notes : null,
    keywords: typeof e?.keywords === 'string' && e.keywords.trim() ? e.keywords : null,
    importedFrom: typeof e?.importedFrom === 'string' && e.importedFrom ? e.importedFrom : null,
  }
}

export async function getFurnExtras(projectId: string): Promise<FurnProjectExtras> {
  const s = await readJson<Store>(KEY, {})
  return clean(s[projectId])
}

export async function setFurnExtras(projectId: string, patch: Partial<FurnProjectExtras>): Promise<void> {
  await mutateJson<Store>(KEY, {}, (s) => ({ ...s, [projectId]: clean({ ...EMPTY, ...(s[projectId] || {}), ...patch }) }))
}

export async function deleteFurnExtras(projectId: string): Promise<void> {
  await mutateJson<Store>(KEY, {}, (s) => { const n = { ...s }; delete n[projectId]; return n })
}

/** Every BOQ file of a project: the extras list when set, else the row's single boq_url. */
export function resolveBoqFiles(
  row: { boq_url: string | null; boq_filename: string | null },
  extras: FurnProjectExtras,
): FurnBoqFile[] {
  if (extras.boqFiles.length > 0) return extras.boqFiles
  return row.boq_url ? [{ url: row.boq_url, name: row.boq_filename || 'BOQ' }] : []
}
