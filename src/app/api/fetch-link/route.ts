// POST /api/fetch-link — download a file from a PUBLIC cloud link and store it
// in S3, returning it in the same shape the upload flow uses so the form can
// drop it into a file bucket.
//
// Scope (your decision): PUBLIC DIRECT links only — no password/OTP automation.
// Common share links that resolve to a direct download are transformed here
// (Google Drive, Dropbox). Anything needing a login/OTP is out — the user
// downloads those and uploads the file.
//
// Security — this fetches an ARBITRARY external URL server-side, so:
//   • http(s) only; the host is checked against private/loopback/link-local
//     ranges + cloud-metadata names (basic SSRF guard);
//   • a hard size cap and timeout so a huge/slow URL can't exhaust the server;
//   • the bytes go straight to our bucket; the response is never proxied back.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { uploadBufferToS3, safeExtension, safeNameStem } from '@/lib/s3'
import { policyFor, mimeAllowed } from '@/lib/upload-policy'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES = 80 * 1024 * 1024 // 80 MB — a big drawing set / zip
const TIMEOUT_MS = 60_000

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  if (h === 'metadata.google.internal' || h === '169.254.169.254') return true
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}

// Turn common SHARE links into their DIRECT-download form.
function directUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    // Google Drive: /file/d/<id>/view  →  uc?export=download&id=<id>
    if (host.includes('drive.google.com')) {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/) || [null, u.searchParams.get('id')]
      if (m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`
    }
    // Dropbox: force dl=1 (direct)
    if (host.includes('dropbox.com')) {
      u.searchParams.set('dl', '1')
      return u.toString()
    }
    return raw
  } catch {
    return raw
  }
}

function filenameFrom(res: Response, url: string): string {
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  if (m && m[1]) { try { return decodeURIComponent(m[1].trim()) } catch { return m[1].trim() } }
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (p) return decodeURIComponent(p)
  } catch { /* ignore */ }
  return 'file'
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Gate on a real intake permission — this fetches an arbitrary external URL
  // server-side, so it must not be callable by every signed-in account.
  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.furn') && !hasPermission(profile, permissions, 'page.client_projects')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { url?: unknown; kind?: unknown; folder?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  const kind = typeof body.kind === 'string' && body.kind ? body.kind : 'projects'
  const policy = policyFor(kind)
  if (!policy) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })

  let target: URL
  try { target = new URL(directUrl(rawUrl)) } catch { return NextResponse.json({ error: 'رابط غير صالح' }, { status: 400 }) }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'يُسمح بروابط http/https فقط' }, { status: 400 })
  }
  if (isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: 'هذا العنوان غير مسموح' }, { status: 400 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(target.toString(), { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'KaasebBot/1.0' } })
  } catch (e) {
    clearTimeout(timer)
    return NextResponse.json({ error: `تعذّر الوصول للرابط: ${e instanceof Error ? e.message : 'فشل'}` }, { status: 502 })
  }
  if (!res.ok) { clearTimeout(timer); return NextResponse.json({ error: `الرابط رد بخطأ ${res.status}` }, { status: 502 }) }

  // Re-check the FINAL host after redirects — a public link that 30x-redirects
  // to an internal address would otherwise slip past the initial-URL guard.
  try {
    if (res.url && isBlockedHost(new URL(res.url).hostname)) {
      clearTimeout(timer)
      return NextResponse.json({ error: 'الرابط يعيد التوجيه لعنوان غير مسموح' }, { status: 400 })
    }
  } catch { /* keep going — res.url malformed is not itself a breach */ }

  // A share LANDING page (needs login/OTP) usually returns HTML — reject with a
  // clear message instead of storing a webpage as a "drawing".
  const ctype = (res.headers.get('content-type') || '').toLowerCase()
  if (ctype.startsWith('text/html')) {
    clearTimeout(timer)
    return NextResponse.json({ error: 'الرابط صفحة ويب لا ملف مباشر — إذا يطلب تسجيل/كلمة سر، حمّل الملف وارفعه يدوياً.' }, { status: 415 })
  }

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_BYTES) { clearTimeout(timer); return NextResponse.json({ error: 'الملف أكبر من الحد المسموح' }, { status: 413 }) }

  let buf: Buffer
  try {
    const ab = await res.arrayBuffer()
    buf = Buffer.from(ab)
  } catch (e) {
    return NextResponse.json({ error: `تعذّر تحميل الملف: ${e instanceof Error ? e.message : 'فشل'}` }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
  if (buf.byteLength === 0) return NextResponse.json({ error: 'الملف فارغ' }, { status: 422 })
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'الملف أكبر من الحد المسموح' }, { status: 413 })

  const name = filenameFrom(res, target.toString())
  const contentType = ctype.split(';')[0] || 'application/octet-stream'
  if (!mimeAllowed(policy, contentType) && !mimeAllowed(policy, 'application/octet-stream')) {
    return NextResponse.json({ error: 'نوع الملف غير مسموح لهذه الوجهة' }, { status: 415 })
  }

  const rawFolder = typeof body.folder === 'string' ? body.folder.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) : ''
  const stem = safeNameStem(name)
  const ext = safeExtension(name)
  const rand = `${user.id.slice(0, 6)}-${stem}`.replace(/[^a-zA-Z0-9._-]/g, '')
  const key = `${kind}/${rawFolder || user.id}/link-${rand}-${buf.byteLength}.${ext}`

  try {
    const up = await uploadBufferToS3({ buffer: buf, key, contentType })
    return NextResponse.json({ url: up.url, key: up.key, bytes: up.bytes, name })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'فشل الحفظ' }, { status: 500 })
  }
}
