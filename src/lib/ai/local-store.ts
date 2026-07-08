// AI settings store — backed by a JSON object in S3 (durable + works in
// serverless, unlike a local file). Same shape and function names as before;
// only the storage backend changed. The OpenAI key is the SAME AES-256-GCM
// envelope (encrypted via src/lib/encryption.ts), never plaintext.

import { readJson, writeJson } from '@/lib/s3'
import type { AiSettings } from '@/types'

const KEY = 'app-data/ai-settings.json'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  id: 1,
  provider: 'openai',
  openai_api_key: null,
  openai_model: 'gpt-5.4-mini',
  openai_boq_model: 'gpt-5.4',
  gemini_api_key: null,
  gemini_model: 'gemini-2.5-flash',
  gemini_boq_model: 'gemini-2.5-pro',
  updated_at: new Date(0).toISOString(),
  updated_by: null,
}

export async function readLocalAiSettings(): Promise<AiSettings | null> {
  const data = await readJson<AiSettings | null>(KEY, null)
  return data ? { ...DEFAULT_AI_SETTINGS, ...data, id: 1 } : null
}

// Merge a partial patch over whatever is stored (or defaults) and persist.
export async function writeLocalAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const current = (await readLocalAiSettings()) ?? DEFAULT_AI_SETTINGS
  const merged: AiSettings = {
    ...current,
    ...patch,
    id: 1,
    updated_at: new Date().toISOString(),
  }
  await writeJson(KEY, merged)
  return merged
}
