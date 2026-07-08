// GET /api/ai/models — live text-model lists for the AI Settings dropdowns.
//
// Pulls the up-to-date model catalogue from each provider (using the stored /
// env key) and keeps only chat/document-capable text models. Always merged with
// a small curated fallback so the dropdown is never empty even if a key is
// missing or the list call fails. Super-admin only.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAiKey, getGeminiKey } from '@/lib/ai/config'

export const runtime = 'nodejs'

const OPENAI_FALLBACK = ['gpt-5.5', 'gpt-5.4', 'gpt-5.5-mini', 'gpt-5.4-mini']
const GEMINI_FALLBACK = ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash']

// Keep chat/reasoning text models; drop image/audio/embedding/etc.
const OPENAI_INCLUDE = /^(gpt-|o\d|chatgpt)/i
const OPENAI_EXCLUDE = /(image|audio|tts|realtime|whisper|embedding|moderation|dall|transcrib|search|sora|computer-use)/i
const GEMINI_EXCLUDE = /(image|tts|audio|embedding|aqa|learnlm)/i

async function listOpenAi(): Promise<string[]> {
  const key = await getOpenAiKey()
  if (!key) return []
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return []
    const j = await r.json()
    return (j.data || [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => OPENAI_INCLUDE.test(id) && !OPENAI_EXCLUDE.test(id))
  } catch { return [] }
}

async function listGemini(): Promise<string[]> {
  const key = await getGeminiKey()
  if (!key) return []
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=300`)
    if (!r.ok) return []
    const j = await r.json()
    return (j.models || [])
      .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((id: string) => /gemini/i.test(id) && !GEMINI_EXCLUDE.test(id))
  } catch { return [] }
}

// Dedupe + sort newest-ish first (numeric-aware descending).
function merge(live: string[], fallback: string[]): string[] {
  return Array.from(new Set([...live, ...fallback]))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [openai, gemini] = await Promise.all([listOpenAi(), listGemini()])
  return NextResponse.json({
    openai: merge(openai, OPENAI_FALLBACK),
    gemini: merge(gemini, GEMINI_FALLBACK),
  })
}
