// GET /api/tannoor/projects/[id]/sources → { sources: { [itemId]: source } }
// The audit "source" per item, read from the local map (no DB column).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProjectItemSources } from '@/lib/tannoor/item-sources'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ sources: await getProjectItemSources(id) })
}
