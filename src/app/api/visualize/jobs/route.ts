// GET /api/visualize/jobs — list saved "النفق السحري" renders (newest first).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listJobs } from '@/lib/visualize/jobs'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobs = await listJobs()
  return NextResponse.json({ jobs })
}
