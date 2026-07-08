// Resolves the *effective* AI configuration the runtime should use.
//
// Source of truth is the singleton `ai_settings` row, read with the
// service-role (admin) client so this works from any server context regardless
// of the caller's RLS. The OpenAI key is stored encrypted and decrypted here,
// on the server only. Environment variables are the fallback so the app keeps
// working before anyone opens the Settings page:
//   • OpenAI key:  ai_settings.openai_api_key (decrypted) → env OPENAI_API_KEY
//   • Gemini key:  env GEMINI_API_KEY (not yet surfaced in the UI)
//
// `documentModel` is used for BOQ extraction (needs vision + structured
// output); `chatModel` for the assistant.

import { createAdminClient } from '@/lib/supabase/admin'
import { decryptSecret, isEncrypted } from '@/lib/encryption'
import { readLocalAiSettings } from './local-store'
import type { AiProviderId, AiSettings } from '@/types'

export interface ResolvedAiConfig {
  provider: AiProviderId
  apiKey: string | null
  chatModel: string
  documentModel: string
}

// Hard defaults if the row is missing entirely (fresh DB before migration).
// gpt-5.4 = frontier reasoning model, 1M-token context, vision + structured
// output — the document/BOQ workhorse. gpt-5.4-mini = cheap, capable chat.
const DEFAULTS = {
  provider: 'openai' as AiProviderId,
  openai_model: 'gpt-5.4-mini',
  openai_boq_model: 'gpt-5.4',
  gemini_model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
}

async function loadRow(): Promise<Partial<AiSettings> | null> {
  // Prefer the Supabase table; if it's there and has a row, use it.
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('ai_settings').select('*').eq('id', 1).maybeSingle()
    if (!error && data) return data as AiSettings
  } catch {
    /* table missing / admin client misconfigured — fall through to local file */
  }
  // Local-dev fallback: settings saved to a JSON file (no Supabase needed).
  try {
    return await readLocalAiSettings()
  } catch {
    return null
  }
}

function decryptKey(stored: string | null | undefined): string | null {
  if (!stored) return null
  try {
    return isEncrypted(stored) ? decryptSecret(stored) : stored
  } catch {
    // Tampered / wrong key — treat as unset rather than crashing the request.
    return null
  }
}

export async function getAiConfig(): Promise<ResolvedAiConfig> {
  const row = await loadRow()
  const provider = (row?.provider as AiProviderId) || DEFAULTS.provider

  if (provider === 'gemini') {
    return {
      provider: 'gemini',
      apiKey: decryptKey(row?.gemini_api_key) || process.env.GEMINI_API_KEY || null,
      chatModel: row?.gemini_model || DEFAULTS.gemini_model,
      documentModel: row?.gemini_boq_model || process.env.GEMINI_BOQ_MODEL || row?.gemini_model || DEFAULTS.gemini_model,
    }
  }

  // OpenAI (default).
  const apiKey = decryptKey(row?.openai_api_key) || process.env.OPENAI_API_KEY || null
  return {
    provider: 'openai',
    apiKey,
    chatModel: row?.openai_model || DEFAULTS.openai_model,
    documentModel: row?.openai_boq_model || row?.openai_model || DEFAULTS.openai_boq_model,
  }
}

// Provider-specific key resolvers. Needed when a feature lets the user pick a
// provider independently of the global `ai_settings` provider (e.g. the Magic
// Tunnel, where OpenAI and Gemini are chosen per-render).
export async function getOpenAiKey(): Promise<string | null> {
  const row = await loadRow()
  return decryptKey(row?.openai_api_key) || process.env.OPENAI_API_KEY || null
}

export async function getGeminiKey(): Promise<string | null> {
  const row = await loadRow()
  return decryptKey(row?.gemini_api_key) || process.env.GEMINI_API_KEY || null
}
