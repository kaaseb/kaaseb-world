// GET /api/tannoor/projects/[id]/process/progress — the router run's live state
// (same progress blob the Furn run writes, keyed by project id).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readRunProgress } from '@/lib/boq/router/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const progress = await readRunProgress(id)
  return NextResponse.json({ progress })
}
