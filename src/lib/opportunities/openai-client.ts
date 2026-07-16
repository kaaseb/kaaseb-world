// Shared OpenAI plumbing for the scout (search.ts) and the contact hunt
// (contacts.ts). Both need the same two things — a model that actually exists,
// and a request that survives a rate-limit blip — so it lives in one place
// rather than being copy-pasted and drifting.

import OpenAI from 'openai'
import { getAiConfig } from '@/lib/ai/config'

// gpt-5.x / o-series reject `temperature` and take `reasoning.effort` instead —
// same branch the shared OpenAI provider makes (src/lib/ai/providers/openai.ts).
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model)
}

// Models we'd happily run on, best first. All are Responses-API models that
// support the web_search tool.
const PREFERRED_MODELS = [
  'gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5-mini', 'gpt-5.5',
  'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o',
]

// Not text/chat models — never pick these as a last resort.
const NOT_CHAT = /(image|audio|tts|realtime|whisper|embedding|moderation|dall|transcrib|sora|computer-use)/i

// What the account can ACTUALLY call. Mirrors src/app/api/ai/models/route.ts.
async function listAvailableModels(apiKey: string): Promise<Set<string>> {
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!r.ok) return new Set()
    const j = (await r.json()) as { data?: Array<{ id: string }> }
    return new Set((j.data || []).map((m) => m.id))
  } catch {
    return new Set()
  }
}

// Pick the model to run with.
//
// WHY WE DON'T JUST TRUST ai_settings: the Settings dropdown merges the live
// catalogue with a hard-coded fallback list (api/ai/models/route.ts), so it can
// offer — and save — a model id this account cannot actually call. That is a
// real thing that happened: `gpt-5.5-mini` was configured and every scan died
// with "400 The requested model does not exist". So we verify against the live
// list and degrade to something real instead of failing.
export async function resolveModel(apiKey: string): Promise<string> {
  const prefs: string[] = []
  if (process.env.OPPORTUNITIES_MODEL) prefs.push(process.env.OPPORTUNITIES_MODEL)
  try {
    const cfg = await getAiConfig()
    if (cfg.provider === 'openai' && cfg.chatModel) prefs.push(cfg.chatModel)
  } catch {
    /* settings unreadable — the preference list below still stands */
  }
  prefs.push(...PREFERRED_MODELS)

  const available = await listAvailableModels(apiKey)
  // Couldn't read the catalogue (network/permission) — don't block the run,
  // just take the top preference and let any error surface normally.
  if (available.size === 0) return prefs[0] || PREFERRED_MODELS[0]

  for (const p of prefs) if (p && available.has(p)) return p

  // Nothing we know about is available — take the newest generic gpt-* model
  // the account does have rather than giving up.
  const generic = [...available]
    .filter((id) => /^gpt-/i.test(id) && !NOT_CHAT.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  if (generic[0]) return generic[0]

  throw new Error('ما فيه أي موديل OpenAI متاح لهذا المفتاح — راجع إعدادات الذكاء.')
}

// A web_search request is token-heavy, so it can collide with whatever else the
// org is doing and come back 429. OpenAI tells us exactly how long to wait
// ("try again in 13.7s"), so honour that instead of failing a request that
// would have worked seconds later.
export async function createWithRetry(
  client: OpenAI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any,
  attempts = 3,
): Promise<unknown> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.responses.create(params)
    } catch (e) {
      lastErr = e
      const err = e as { status?: number; message?: string }
      if (err.status !== 429 || i === attempts - 1) throw e
      const m = /try again in ([\d.]+)\s*s/i.exec(err.message || '')
      const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 2000 : (i + 1) * 10_000
      // Hard ceiling: a TPM window is 60s, so waiting longer than ~30s buys
      // nothing and only drags the run toward the stale threshold.
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)))
    }
  }
  throw lastErr
}
