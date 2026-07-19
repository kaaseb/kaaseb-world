// POST /api/visualize — "النفق السحري" (background render)
//
// Creates a render JOB, kicks the actual OpenAI work off in the BACKGROUND
// (fire-and-forget on the long-running Node server), and returns the job id
// immediately. The browser can navigate away / close; the job keeps running and
// writes its result image to S3, surfaced by GET /api/visualize/jobs.
//
// Body: {
//   sceneUrl,                       // uploaded scene photo (required)
//   mode?: 'surface' | 'place',
//   productImageUrl?,               // catalog image OR a quick-uploaded image
//   productId?,                     // fallback: resolve image from the S3 map
//   marbleName?, surfaces?[], placementHint?, notes?
// }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { applyMarbleToScene } from '@/lib/ai/image'
import { getProductImages } from '@/lib/tannoor/product-images'
import { uploadBufferToS3 } from '@/lib/s3'
import { createJob, updateJob } from '@/lib/visualize/jobs'
import { bumpUsage } from '@/lib/visualize/product-usage'
import {
  isValidProvider, defaultModelFor, DEFAULT_PROVIDER,
  type ImageProvider, type ImageQuality,
} from '@/lib/ai/image-models'

export const runtime = 'nodejs'
export const maxDuration = 300

async function fetchImage(url: string): Promise<{ data: Buffer; mime: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  return { data: Buffer.from(await res.arrayBuffer()), mime }
}

// Runs detached from the request. Updates the job to done/failed when finished.
async function runJob(jobId: string, p: {
  sceneUrl: string
  productUrl: string
  mode: 'surface' | 'place'
  surfaces: string[]
  marbleName: string
  placementHint: string
  provider: ImageProvider
  model: string
  quality: ImageQuality
}): Promise<void> {
  try {
    const scene = await fetchImage(p.sceneUrl)
    let marble: { data: Buffer; mime: string } | undefined
    if (p.productUrl) {
      try { marble = await fetchImage(p.productUrl) } catch { /* reference optional in surface mode */ }
    }
    const b64 = await applyMarbleToScene({
      scene,
      marble,
      mode: p.mode,
      surfaces: p.surfaces,
      marbleName: p.marbleName,
      placementHint: p.placementHint,
      provider: p.provider,
      model: p.model,
      quality: p.quality,
    })
    const buffer = Buffer.from(b64, 'base64')
    const { url, key } = await uploadBufferToS3({
      buffer,
      key: `visualize/${jobId}.png`,
      contentType: 'image/png',
    })
    await updateJob(jobId, { status: 'done', resultUrl: url, resultKey: key })
  } catch (e) {
    await updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'Visualization failed' })
  }
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    sceneUrl?: string
    mode?: 'surface' | 'place'
    productImageUrl?: string
    productId?: string
    marbleName?: string
    surfaces?: string[]
    placementHint?: string
    notes?: string
    provider?: string
    model?: string
    quality?: string
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body.sceneUrl) return NextResponse.json({ error: 'sceneUrl required' }, { status: 400 })

  const mode = body.mode === 'place' ? 'place' : 'surface'

  // Per-render provider/model/quality (validated against the shared catalog).
  const provider: ImageProvider = isValidProvider(body.provider) ? body.provider : DEFAULT_PROVIDER
  // Accept any non-empty model id (the dropdown is live — the provider API
  // validates it). Fall back to the provider default when absent.
  const model = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim().slice(0, 100)
    : defaultModelFor(provider)
  const quality: ImageQuality =
    provider === 'openai' && (body.quality === 'low' || body.quality === 'medium' || body.quality === 'high')
      ? body.quality
      : 'high'

  // Cost gate — the REAL one. OpenAI image generation is super-admin only; this
  // is enforced here on the server, so a direct API call with provider:'openai'
  // can't bypass it (the client lock is only a matching UI hint). Everyone else
  // uses the free Gemini default.
  const { data: profile } = await supabase
    .from('profiles').select('full_name, role').eq('id', user.id).maybeSingle()
  if (provider === 'openai' && profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'محرك OpenAI متاح للمدير فقط (تحكّم بالتكلفة) — استخدم Gemini.' }, { status: 403 })
  }

  // Resolve the product image up-front (catalog URL / quick upload / productId).
  let productUrl = body.productImageUrl || ''
  if (!productUrl && body.productId) {
    productUrl = (await getProductImages())[body.productId] || ''
  }
  if (mode === 'place' && !productUrl) {
    return NextResponse.json({ error: 'A product image is required to place a product.' }, { status: 400 })
  }

  const job = await createJob({
    mode,
    sceneUrl: body.sceneUrl,
    productImageUrl: productUrl,
    productName: (body.marbleName || '').slice(0, 120),
    surfaces: mode === 'surface' ? (body.surfaces || []).slice(0, 8) : [],
    placementHint: mode === 'place' ? (body.placementHint || '').slice(0, 400) : '',
    notes: (body.notes || '').slice(0, 1000),
    provider,
    model,
    quality,
    createdBy: user.id,
    createdByName: profile?.full_name || null,
  })

  // Count catalogue-product usage so the picker can default to most-used.
  if (body.productId) void bumpUsage(body.productId)

  // Fire-and-forget — do NOT await. The Node server keeps the promise running
  // after we respond, so the render survives the browser navigating away.
  void runJob(job.id, {
    sceneUrl: job.sceneUrl,
    productUrl,
    mode,
    surfaces: job.surfaces,
    marbleName: job.productName,
    placementHint: job.placementHint,
    provider,
    model,
    quality,
  })

  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
