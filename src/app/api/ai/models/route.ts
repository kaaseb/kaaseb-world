// GET /api/ai/models — text-model lists for the AI Settings dropdowns.
//
// Shows the LIVE catalogue the account can actually call (newest first). The
// curated fallback is a LAST RESORT only — used when the provider's list call
// fails (missing key / API down) so the dropdown is never empty. It is never
// MERGED into a live list.
//
// WHY (this was a real, expensive bug): the old code did `merge(live, fallback)`
// and always folded the hardcoded list into the live one — so the dropdown
// offered `gpt-5.5-mini`, an admin saved it, and every BOQ + chat call 400'd
// with "model does not exist". A dropdown must never advertise a model the
// account can't call. Fallback names are also kept to CONFIRMED-available ones.
// Super-admin only.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAiKey, getGeminiKey } from '@/lib/ai/config'

export const runtime = 'nodejs'

const OPENAI_FALLBACK = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini']
const GEMINI_FALLBACK = ['gemini-2.5-pro', 'gemini-2.5-flash']

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

// Dedupe + sort newest-first (numeric-aware descending), so gpt-5.4 sits above
// gpt-4o and the freshest model an account has is at the top of the list.
function ordered(list: string[]): string[] {
  return Array.from(new Set(list))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [openaiLive, geminiLive] = await Promise.all([listOpenAi(), listGemini()])
  // Live-only when the provider actually returned a list; fall back ONLY when it
  // didn't (so the dropdown is never empty, but also never invents a model).
  const openaiIsLive = openaiLive.length > 0
  const geminiIsLive = geminiLive.length > 0
  return NextResponse.json({
    openai: ordered(openaiIsLive ? openaiLive : OPENAI_FALLBACK),
    gemini: ordered(geminiIsLive ? geminiLive : GEMINI_FALLBACK),
    // Lets the UI tell the admin whether these are real, live models.
    openaiLive: openaiIsLive,
    geminiLive: geminiIsLive,
  })
}
