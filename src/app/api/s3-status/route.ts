// Read-only summary of how the server is wired to AWS S3. Used by the
// Settings page so a super-admin can sanity-check the .env values without
// SSH-ing into the box. Never returns the secret key.

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

export const dynamic = 'force-dynamic'

function maskAccessKey(key: string | undefined): string | null {
  if (!key) return null
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}${'•'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const region    = process.env.AWS_REGION || null
  const bucket    = process.env.AWS_S3_BUCKET || null
  const accessKey = maskAccessKey(process.env.AWS_ACCESS_KEY_ID)
  const hasSecret = !!process.env.AWS_SECRET_ACCESS_KEY
  const publicUrl = process.env.AWS_S3_PUBLIC_URL
    || (bucket && region ? `https://${bucket}.s3.${region}.amazonaws.com` : null)

  let reachable: boolean | null = null
  let reachError: string | null = null
  if (region && bucket && process.env.AWS_ACCESS_KEY_ID && hasSecret) {
    try {
      const client = new S3Client({
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      })
      await client.send(new HeadBucketCommand({ Bucket: bucket }))
      reachable = true
    } catch (e) {
      reachable = false
      reachError = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({
    region, bucket, accessKey, hasSecret, publicUrl,
    reachable, reachError,
  })
}
