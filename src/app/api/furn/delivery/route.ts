// GET   /api/furn/delivery            → presets (+ ?projectId=… → that project's choice + shipping)
// PATCH /api/furn/delivery            → super-admin: update the "included" sentence
// POST  /api/furn/delivery            → set a project's { projectId, choice, shipping }
//
// Backed by a local JSON file (src/lib/furn/delivery-store) so it works with no
// Supabase/SQL access.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import {
  getDeliveryPresets, setDeliveryPresets, getDelivery, setDelivery,
  type DeliveryChoice,
} from '@/lib/furn/delivery-store'

const PRESET_KEYS = ['included_ar', 'included_en'] as const
const CHOICES: DeliveryChoice[] = ['included', 'excluded', 'none']

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  const presets = await getDeliveryPresets()
  const delivery = projectId ? await getDelivery(projectId) : null
  return NextResponse.json({ presets, choice: delivery?.choice ?? null, shipping: delivery?.shipping ?? 0 })
}

export async function PATCH(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const patch: Record<string, string> = {}
  for (const k of PRESET_KEYS) {
    if (typeof body[k] === 'string') patch[k] = (body[k] as string).slice(0, 500)
  }
  const presets = await setDeliveryPresets(patch)
  return NextResponse.json({ presets })
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; choice?: string; shipping?: number }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!CHOICES.includes(body.choice as DeliveryChoice)) {
    return NextResponse.json({ error: 'Invalid choice' }, { status: 400 })
  }

  await setDelivery(body.projectId, body.choice as DeliveryChoice, Number(body.shipping) || 0)
  return NextResponse.json({ ok: true })
}
