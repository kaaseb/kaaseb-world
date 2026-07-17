// GET /api/furn/projects/[id]/process/progress — the router run's live state.
//
// Read by FurnDetail while a run is in flight, so the team sees honest coverage
// ("فهرسة الملفات 34/200") instead of a spinner that could mean anything.

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
