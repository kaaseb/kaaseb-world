// GET /api/furn/projects/[id]/sources → { sources: { [itemId]: source } }
// The audit "source" per Furn item, read from the S3 map (kept out of details).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { denyUnlessPermitted } from '@/lib/api-guard'
import { getProjectItemSources } from '@/lib/furn/item-sources'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Furn data is for Furn users only — same gate as the page itself.
  const deny = await denyUnlessPermitted('page.furn')
  if (deny) return deny
  return NextResponse.json({ sources: await getProjectItemSources(id) })
}
