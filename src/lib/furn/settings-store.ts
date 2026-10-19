// Quotation branding + default terms (Furn / Tannoor / manual quotes share it).
//
// ROOT FIX for "the logo & header don't save": the settings form PATCHed every
// field in ONE update of `furn_settings`, including `seal_image_url` — a column
// that only exists if a migration was run. Where it wasn't, PostgREST rejected
// the whole update and nothing (header, signature, phone…) was ever saved.
// No migration is possible, so these fields now live in S3
// (app-data/furn-settings.json) layered OVER the DB row: an old value still in
// the row keeps showing until the team saves a new one.
//
// `next_quotation_number` stays in the DB — finalize allocates numbers from it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { readJson, mutateJson } from '@/lib/s3'
import { createAdminClient } from '@/lib/supabase/admin'
import type { FurnSettings } from '@/types'

const KEY = 'app-data/furn-settings.json'

export const IMAGE_FIELDS = ['header_image_url', 'signature_image_url', 'seal_image_url'] as const
export const TEXT_FIELDS = [
  'manager_name', 'company_phone', 'company_email',
  'commercial_register', 'tax_number', 'footer_address',
  'default_payment_terms', 'default_delivery_terms',
  'default_offer_duration', 'default_special_conditions',
] as const
type OverlayKey = (typeof IMAGE_FIELDS)[number] | (typeof TEXT_FIELDS)[number]
type Overlay = Partial<Record<OverlayKey, string | null>>

/** The DB row (whatever columns it has) with the S3 values on top. */
export async function getFurnSettings(supabase: SupabaseClient): Promise<FurnSettings> {
  const [{ data: row }, overlay] = await Promise.all([
    supabase.from('furn_settings').select('*').eq('id', 1).maybeSingle(),
    readJson<Overlay>(KEY, {}),
  ])
  return { ...((row || {}) as FurnSettings), ...overlay }
}

/** Validate one field; `undefined` = reject (ignored). */
function clean(key: OverlayKey, v: unknown): string | null | undefined {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if ((IMAGE_FIELDS as readonly string[]).includes(key)) return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : undefined
  return s.slice(0, 5000) || null
}

export async function saveFurnSettings(body: Record<string, unknown>): Promise<FurnSettings> {
  const patch: Overlay = {}
  for (const k of [...IMAGE_FIELDS, ...TEXT_FIELDS]) {
    if (!(k in body)) continue
    const v = clean(k, body[k])
    if (v !== undefined) patch[k] = v
  }
  const admin = createAdminClient()
  if ('next_quotation_number' in body) {
    const n = Math.floor(Number(body.next_quotation_number))
    if (Number.isFinite(n) && n >= 1) {
      const { error } = await admin.from('furn_settings').update({ next_quotation_number: n }).eq('id', 1)
      if (error) throw new Error(`تعذّر حفظ رقم العرض التالي: ${error.message}`)
    }
  }
  if (Object.keys(patch).length > 0) await mutateJson<Overlay>(KEY, {}, (cur) => ({ ...cur, ...patch }))
  return getFurnSettings(admin)
}
