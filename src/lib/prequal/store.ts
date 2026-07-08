// Pre-qualification templates, stored as a JSON object in S3.
//   • Defaults: cover + back files + TOC title (set in Settings).
//   • Per-packet overrides: a specific pre-qual can use its own cover/back
//     (uploaded on the create screen) while everything else uses the default.
//
// Every generated packet wraps the chosen documents:
//   [ cover ] → [ auto Table of Contents ] → [ documents ] → [ back ]

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/prequal-templates.json'

export interface PreQualTemplates {
  cover_url: string | null
  back_url: string | null
  toc_title_ar: string
  toc_title_en: string
}

interface Override { cover_url?: string | null; back_url?: string | null }
interface Store extends PreQualTemplates { overrides: Record<string, Override> }

const DEFAULTS: PreQualTemplates = {
  cover_url: null,
  back_url: null,
  toc_title_ar: 'جدول المحتويات',
  toc_title_en: 'Table of Contents',
}

async function read(): Promise<Store> {
  const d = await readJson<Partial<Store>>(KEY, {})
  return { ...DEFAULTS, ...d, overrides: d.overrides || {} }
}

async function write(s: Store): Promise<void> {
  await writeJson(KEY, s)
}

// ── Defaults (Settings) ──────────────────────────────────────────────────────
export async function getPreQualTemplates(): Promise<PreQualTemplates> {
  const s = await read()
  return { cover_url: s.cover_url, back_url: s.back_url, toc_title_ar: s.toc_title_ar, toc_title_en: s.toc_title_en }
}

export async function setPreQualTemplates(patch: Partial<PreQualTemplates>): Promise<PreQualTemplates> {
  const s = await read()
  Object.assign(s, patch)
  await write(s)
  return getPreQualTemplates()
}

// ── Per-packet override ──────────────────────────────────────────────────────
export async function setPreQualOverride(pqId: string, ov: Override): Promise<void> {
  const s = await read()
  const merged: Override = { ...(s.overrides[pqId] || {}), ...ov }
  if (!merged.cover_url) delete merged.cover_url
  if (!merged.back_url) delete merged.back_url
  if (Object.keys(merged).length === 0) delete s.overrides[pqId]
  else s.overrides[pqId] = merged
  await write(s)
}

// Resolved templates for one packet: override wins per field, else the default.
export async function getPreQualForProject(pqId: string): Promise<PreQualTemplates> {
  const s = await read()
  const ov = s.overrides[pqId] || {}
  return {
    cover_url: ov.cover_url ?? s.cover_url,
    back_url: ov.back_url ?? s.back_url,
    toc_title_ar: s.toc_title_ar,
    toc_title_en: s.toc_title_en,
  }
}
