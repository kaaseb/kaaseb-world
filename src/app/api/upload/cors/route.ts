// POST /api/upload/cors — allow the browser to PUT straight to the S3 bucket.
//
// Direct-to-S3 uploads are blocked by the browser's CORS preflight until the
// bucket says the site may write to it. Rather than walking the owner through
// the AWS console, this sets the rule from the app — one click, idempotent.
//
// Super-admin only (it changes a bucket-level setting), and the allowed origin
// is taken from the verified request origin, so it can only ever whitelist the
// site the admin is actually using.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { ensureUploadCors } from '@/lib/s3'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'هذا الإجراء للسوبر أدمن فقط.' }, { status: 403 })
  }

  // verifyOrigin already proved this header matches an allowed site origin.
  const origin = request.headers.get('origin') || ''
  if (!/^https?:\/\//.test(origin)) {
    return NextResponse.json({ error: 'تعذّر تحديد عنوان الموقع.' }, { status: 400 })
  }

  try {
    await ensureUploadCors([origin])
    return NextResponse.json({ ok: true, origin })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'فشل الضبط'
    // The usual cause is an IAM user without s3:PutBucketCors — say so plainly
    // so the fix is obvious instead of a raw AWS error code.
    return NextResponse.json({
      error: `تعذّر ضبط CORS للمخزن: ${msg}. تأكد أن مستخدم AWS عنده صلاحية s3:PutBucketCors، أو اضبطها يدوياً من كونسول S3.`,
    }, { status: 500 })
  }
}
