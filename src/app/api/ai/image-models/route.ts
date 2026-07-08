// GET /api/ai/image-models — LIVE image-generation/edit models per provider for
// the Magic Tunnel engine dropdown. So new image models appear automatically
// (no hardcoding) and the list is always the real, complete set for the key.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAiKey, getGeminiKey } from '@/lib/ai/config'

export const runtime = 'nodejs'

async function listOpenAiImages(): Promise<string[]> {
  const key = await getOpenAiKey()
  if (!key) return []
  try {
    const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    if (!r.ok) return []
    const j = await r.json()
    return (j.data || [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => /^gpt-image/i.test(id))
  } catch { return [] }
}

async function listGeminiImages(): Promise<string[]> {
  const key = await getGeminiKey()
  if (!key) return []
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=300`)
    if (!r.ok) return []
    const j = await r.json()
    return (j.models || [])
      .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((id: string) => /(image|nano-banana)/i.test(id))
  } catch { return [] }
}

// Newest-ish first (numeric-aware descending).
function sortDesc(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [openai, gemini] = await Promise.all([listOpenAiImages(), listGeminiImages()])
  return NextResponse.json({ openai: sortDesc(openai), gemini: sortDesc(gemini) })
}
