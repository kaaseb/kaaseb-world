// GET   /api/ai/settings  — fetch the AI config (key MASKED, never sent raw)
// PATCH /api/ai/settings  — super-admin: switch provider, set models, store key
//
// The OpenAI key is encrypted at rest (src/lib/encryption.ts). The browser only
// ever learns whether a key exists (`has_openai_key`), never its value. Reads
// and writes use the admin client so the encrypted column is handled
// server-side regardless of RLS.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOrigin } from '@/lib/csrf'
import { encryptSecret } from '@/lib/encryption'
import { readLocalAiSettings, writeLocalAiSettings, DEFAULT_AI_SETTINGS } from '@/lib/ai/local-store'
import type { AiSettings, AiSettingsPublic, AiProviderId } from '@/types'

const PROVIDERS: AiProviderId[] = ['openai', 'gemini']

function toPublic(row: AiSettings): AiSettingsPublic {
  return {
    provider: row.provider,
    has_openai_key: !!row.openai_api_key,
    openai_model: row.openai_model,
    openai_boq_model: row.openai_boq_model,
    has_gemini_key: !!row.gemini_api_key,
    gemini_model: row.gemini_model,
    gemini_boq_model: row.gemini_boq_model,
    updated_at: row.updated_at,
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('ai_settings').select('*').eq('id', 1).maybeSingle()
  if (!error && data) {
    return NextResponse.json({ settings: toPublic(data as AiSettings), migrated: true })
  }
  // Table missing (local dev without the migration) — read the local JSON file
  // fallback. Settings still work fully; no Supabase/SQL access required.
  const local = await readLocalAiSettings()
  return NextResponse.json({
    settings: toPublic(local ?? DEFAULT_AI_SETTINGS),
    migrated: true,
  })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only super-admins can change the AI engine / key.
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}

  if (typeof body.provider === 'string') {
    if (!PROVIDERS.includes(body.provider as AiProviderId)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
    }
    patch.provider = body.provider
  }

  // String model fields — trimmed, length-capped, ignored when blank.
  for (const k of ['openai_model', 'openai_boq_model', 'gemini_model', 'gemini_boq_model'] as const) {
    const v = body[k]
    if (typeof v === 'string' && v.trim()) patch[k] = v.trim().slice(0, 100)
  }

  // API keys: a non-empty string is encrypted and stored; an explicit empty
  // string clears it (back to env fallback). `undefined` leaves it as-is.
  if (typeof body.openai_api_key === 'string') {
    const key = body.openai_api_key.trim()
    patch.openai_api_key = key ? encryptSecret(key) : null
  }
  if (typeof body.gemini_api_key === 'string') {
    const key = body.gemini_api_key.trim()
    patch.gemini_api_key = key ? encryptSecret(key) : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No allowed fields' }, { status: 400 })
  }
  patch.updated_by = user.id

  const admin = createAdminClient()
  // Upsert so a fresh DB (row not seeded) still works.
  const { data, error } = await admin
    .from('ai_settings')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    .select('*')
    .single()
  if (!error && data) {
    return NextResponse.json({ settings: toPublic(data as AiSettings) })
  }

  // Table unavailable (local dev without the migration) — persist to the local
  // JSON file instead so saving works with zero Supabase/SQL access.
  const saved = await writeLocalAiSettings(patch as Partial<AiSettings>)
  return NextResponse.json({ settings: toPublic(saved) })
}
