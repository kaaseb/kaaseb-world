// GET /api/tannoor/projects/[id]/sources → { sources: { [itemId]: source }, details: { [itemId]: details } }
// The audit "source" and the descriptive "details" per item, read from the
// local S3 maps (no DB columns).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProjectItemSources } from '@/lib/tannoor/item-sources'
import { getProjectItemDetails } from '@/lib/tannoor/item-details'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [sources, details] = await Promise.all([getProjectItemSources(id), getProjectItemDetails(id)])
  return NextResponse.json({ sources, details })
}
