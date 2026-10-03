// A Furn project's display names in BOTH languages.
//
// The furn_projects row holds ONE string per field (project / company /
// engineer), and it was filled Arabic-first on import — so the ENGLISH
// quotation printed Arabic client data. No migration is possible, so:
//
//   per language:  the team's own edit (S3 extras.names)
//                → the linked client project's value for that language
//                → the row's single value (whatever language it is in)
//
// Existing projects are fixed without re-import (the client project already
// stores name_en / company_en / engineer_name_en), and anything can be
// corrected by hand before sending.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FurnProjectExtras, ProjectNames } from './project-extras'

export interface ResolvedNames {
  project: { ar: string; en: string }
  company: { ar: string; en: string }
  engineer: { ar: string; en: string }
}

interface Row {
  project_name: string | null
  company_name: string | null
  engineer_name: string | null
  source_client_project_id?: string | null
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const hasArabic = (v: string) => /[؀-ۿ]/.test(v)

export async function resolveProjectNames(
  supabase: SupabaseClient,
  row: Row,
  extras: Pick<FurnProjectExtras, 'names'>,
): Promise<ResolvedNames> {
  const o: ProjectNames = extras.names || {}
  let cp: Record<string, unknown> | null = null
  if (row.source_client_project_id) {
    const { data } = await supabase
      .from('client_projects')
      .select('name_ar, name_en, company_ar, company_en, engineer_name_ar, engineer_name_en')
      .eq('id', row.source_client_project_id).maybeSingle()
    cp = (data as Record<string, unknown> | null) || null
  }
  // The row's single value belongs to the language it is actually written in.
  const pick = (override: string | undefined, fromClient: unknown, rowValue: string | null, lang: 'ar' | 'en') => {
    const rv = s(rowValue)
    const rowFits = rv && rv !== '—' && (lang === 'ar' ? hasArabic(rv) : !hasArabic(rv))
    return s(override) || s(fromClient) || (rowFits ? rv : '')
  }
  const both = (ovAr: string | undefined, ovEn: string | undefined, cAr: unknown, cEn: unknown, rv: string | null) => {
    const ar = pick(ovAr, cAr, rv, 'ar')
    const en = pick(ovEn, cEn, rv, 'en')
    const fallback = s(rv) === '—' ? '' : s(rv)
    // A language with nothing of its own shows the other one rather than a blank.
    return { ar: ar || en || fallback, en: en || ar || fallback }
  }
  return {
    project: both(o.project_ar, o.project_en, cp?.name_ar, cp?.name_en, row.project_name),
    company: both(o.company_ar, o.company_en, cp?.company_ar, cp?.company_en, row.company_name),
    engineer: both(o.engineer_ar, o.engineer_en, cp?.engineer_name_ar, cp?.engineer_name_en, row.engineer_name),
  }
}

/** Fields of the English names that still hold Arabic text — worth a nudge. */
export function englishGaps(n: ResolvedNames): Array<'project' | 'company' | 'engineer'> {
  return (['project', 'company', 'engineer'] as const).filter((k) => n[k].en && hasArabic(n[k].en))
}
