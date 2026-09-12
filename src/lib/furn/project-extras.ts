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

/** Outcome of the last «جلب» on one share link — persisted so the card still
 *  says "fetched, N files, when" after navigating away, and offers "fetch again". */
export interface LinkFetch {
  at: string
  status: 'files' | 'needsLogin' | 'password' | 'expired' | 'notFound' | 'page' | 'unsupported'
  provider: string
  files: number
  message?: string
}

export interface FurnProjectExtras {
  boqFiles: FurnBoqFile[]
  notes: string | null
  keywords: string | null
  /** client_projects.id this project was imported from (audit). */
  importedFrom: string | null
  /** Per share link (url → last fetch outcome). */
  linkFetches: Record<string, LinkFetch>
}

type Store = Record<string, Partial<FurnProjectExtras>>

const EMPTY: FurnProjectExtras = { boqFiles: [], notes: null, keywords: null, importedFrom: null, linkFetches: {} }
const LINK_STATUSES = new Set<LinkFetch['status']>(['files', 'needsLogin', 'password', 'expired', 'notFound', 'page', 'unsupported'])
const MAX_LINKS = 100

function cleanLinkFetches(v: unknown): Record<string, LinkFetch> {
  const out: Record<string, LinkFetch> = {}
  if (!v || typeof v !== 'object') return out
  for (const [url, r] of Object.entries(v as Record<string, Partial<LinkFetch>>).slice(-MAX_LINKS)) {
    if (!/^https?:\/\//i.test(url) || url.length > 2048 || !r || typeof r !== 'object') continue
    if (!LINK_STATUSES.has(r.status as LinkFetch['status'])) continue
    out[url] = {
      at: typeof r.at === 'string' ? r.at : new Date(0).toISOString(),
      status: r.status as LinkFetch['status'],
      provider: String(r.provider || '').slice(0, 60),
      files: Math.max(0, Math.floor(Number(r.files) || 0)),
      ...(typeof r.message === 'string' && r.message ? { message: r.message.slice(0, 400) } : {}),
    }
  }
  return out
}

function clean(e: Partial<FurnProjectExtras> | undefined): FurnProjectExtras {
  return {
    boqFiles: Array.isArray(e?.boqFiles)
      ? e!.boqFiles.filter((f) => f && typeof f.url === 'string' && f.url).map((f) => ({ url: f.url, name: String(f.name || 'BOQ').slice(0, 200) }))
      : [],
    notes: typeof e?.notes === 'string' && e.notes.trim() ? e.notes : null,
    keywords: typeof e?.keywords === 'string' && e.keywords.trim() ? e.keywords : null,
    importedFrom: typeof e?.importedFrom === 'string' && e.importedFrom ? e.importedFrom : null,
    linkFetches: cleanLinkFetches(e?.linkFetches),
  }
}

export async function getFurnExtras(projectId: string): Promise<FurnProjectExtras> {
  const s = await readJson<Store>(KEY, {})
  return clean(s[projectId])
}

export async function setFurnExtras(projectId: string, patch: Partial<FurnProjectExtras>): Promise<void> {
  await mutateJson<Store>(KEY, {}, (s) => ({ ...s, [projectId]: clean({ ...EMPTY, ...(s[projectId] || {}), ...patch }) }))
}

/** Record one link's fetch outcome atomically (read-modify-write inside mutateJson). */
export async function recordLinkFetch(projectId: string, url: string, rec: LinkFetch): Promise<Record<string, LinkFetch>> {
  let result: Record<string, LinkFetch> = {}
  await mutateJson<Store>(KEY, {}, (s) => {
    const cur = clean({ ...EMPTY, ...(s[projectId] || {}) })
    const next = { ...cur, linkFetches: cleanLinkFetches({ ...cur.linkFetches, [url]: rec }) }
    result = next.linkFetches
    return { ...s, [projectId]: next }
  })
  return result
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
