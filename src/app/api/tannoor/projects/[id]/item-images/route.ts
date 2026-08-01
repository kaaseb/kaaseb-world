// GET   /api/tannoor/projects/[id]/item-images → { images: { [itemId]: url } }
// PATCH /api/tannoor/projects/[id]/item-images  { itemId, url|null } → attach or
//        clear ONE line's optional quotation thumbnail (stored in S3, no DB col).
//
// Authorization (shared single-org workspace — RLS is authenticated-only, not
// per-row): the PATCH requires the `page.tannoor` permission, and the item must
// actually belong to the named project (the .eq('id').eq('project_id') check
// below). The url must be one of OUR own S3/CDN objects — never an arbitrary
// external link, since it renders straight into the customer PDF.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { isAppOwnedUrl } from '@/lib/s3'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { getProjectItemImages, setProjectItemImage } from '@/lib/tannoor/item-images'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ images: await getProjectItemImages(id) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.tannoor')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { itemId?: unknown; url?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  if (!itemId) return NextResponse.json({ error: 'itemId مطلوب' }, { status: 400 })

  const url = body.url === null ? null : (typeof body.url === 'string' ? body.url.trim() : '')
  if (url && !isAppOwnedUrl(url)) {
    return NextResponse.json({ error: 'رابط الصورة غير صالح — ارفع الصورة عبر النظام.' }, { status: 400 })
  }

  // RLS-scoped ownership check: the row is only visible if the user can see the
  // project. No row → not theirs (or wrong project) → refuse.
  const { data: row } = await supabase
    .from('tannoor_items').select('id').eq('id', itemId).eq('project_id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  await setProjectItemImage(id, itemId, url || null)
  return NextResponse.json({ ok: true })
}
