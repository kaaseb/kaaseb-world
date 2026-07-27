// POST /api/fetch-link — download a file from a PUBLIC cloud link and store it
// in S3, returning it in the same shape the upload flow uses so the form can
// drop it into a file bucket.
//
// Scope (your decision): PUBLIC DIRECT links only — no password/OTP automation.
// Common share links that resolve to a direct download are transformed here
// (Google Drive, Dropbox). Anything needing a login/OTP is out.
//
// SSRF: this fetches an ARBITRARY external URL server-side, so the guard is
// resolve-then-validate — the host is DNS-resolved and EVERY resulting IP must
// be public (this also normalises decimal/hex/octal/IPv6 encodings, which a
// string check misses). Redirects are followed MANUALLY so each hop is
// re-validated, and the body is size-capped WHILE streaming so a chunked
// response with no content-length can't blow past the cap into memory. Gated on
// a real intake permission.

import net from 'net'
import dns from 'dns/promises'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { uploadBufferToS3, safeExtension, safeNameStem } from '@/lib/s3'
import { policyFor, mimeAllowed } from '@/lib/upload-policy'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES = 80 * 1024 * 1024
const TIMEOUT_MS = 60_000
const MAX_HOPS = 5

// ─── SSRF: validate that a host resolves ONLY to public addresses ────────────

function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.')
  if (p.length !== 4) return null
  let n = 0
  for (const s of p) {
    const o = Number(s)
    if (!Number.isInteger(o) || o < 0 || o > 255 || !/^\d+$/.test(s)) return null
    n = n * 256 + o
  }
  return n >>> 0
}
function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return true // unparseable → treat as unsafe
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (b & mask)
  }
  return inRange('0.0.0.0', 8) || inRange('10.0.0.0', 8) || inRange('100.64.0.0', 10)
    || inRange('127.0.0.0', 8) || inRange('169.254.0.0', 16) || inRange('172.16.0.0', 12)
    || inRange('192.0.0.0', 24) || inRange('192.168.0.0', 16) || inRange('198.18.0.0', 15)
    || inRange('224.0.0.0', 4) || inRange('240.0.0.0', 4)
}
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip)
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true
    if (/^f[cd]/.test(low)) return true            // fc00::/7 unique-local
    if (/^fe[89ab]/.test(low)) return true          // fe80::/10 link-local
    const mapped = low.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIpv4(mapped[1])
    return false
  }
  return true // not a real IP → unsafe
}
async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('internal')
    return
  }
  // Resolving normalises numeric encodings (2130706433, 0x7f..., octal) to real
  // IPs and catches DNS names pointing at internal addresses.
  let addrs: Array<{ address: string }>
  try { addrs = await dns.lookup(hostname, { all: true }) } catch { throw new Error('resolve') }
  if (addrs.length === 0) throw new Error('resolve')
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('internal')
}

// Turn common SHARE links into their DIRECT-download form.
function directUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    if (host.includes('drive.google.com')) {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/) || [null, u.searchParams.get('id')]
      if (m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`
    }
    if (host.includes('dropbox.com')) { u.searchParams.set('dl', '1'); return u.toString() }
    return raw
  } catch { return raw }
}

function filenameFrom(res: Response, url: string): string {
  const cd = res.headers.get('content-disposition') || ''
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  if (m && m[1]) { try { return decodeURIComponent(m[1].trim()) } catch { return m[1].trim() } }
  try { const p = new URL(url).pathname.split('/').filter(Boolean).pop(); if (p) return decodeURIComponent(p) } catch { /* ignore */ }
  return 'file'
}

// Manual-redirect fetch: validate the host at EVERY hop.
async function safeFetch(startUrl: string): Promise<{ ok: true; res: Response; finalUrl: string } | { ok: false; error: string; status: number }> {
  let url = startUrl
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, error: 'رابط غير صالح', status: 400 } }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'يُسمح بروابط http/https فقط', status: 400 }
    try { await assertPublicHost(u.hostname) } catch { return { ok: false, error: 'هذا العنوان غير مسموح', status: 400 } }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(u.toString(), { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'KaasebBot/1.0' } })
    } catch (e) {
      clearTimeout(timer)
      return { ok: false, error: `تعذّر الوصول للرابط: ${e instanceof Error ? e.message : 'فشل'}`, status: 502 }
    }
    clearTimeout(timer)

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { ok: false, error: 'إعادة توجيه بلا وجهة', status: 502 }
      try { url = new URL(loc, u).toString() } catch { return { ok: false, error: 'وجهة إعادة التوجيه غير صالحة', status: 502 } }
      continue
    }
    return { ok: true, res, finalUrl: u.toString() }
  }
  return { ok: false, error: 'تحويلات كثيرة جداً', status: 502 }
}

// Read the body with the cap enforced WHILE streaming.
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const reader = res.body?.getReader()
  if (!reader) {
    const ab = await res.arrayBuffer()
    return ab.byteLength <= max ? Buffer.from(ab) : null
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > max) { try { await reader.cancel() } catch { /* ignore */ } return null }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const fetched = await safeFetch(directUrl(rawUrl))
  if (!fetched.ok) return NextResponse.json({ error: fetched.error }, { status: fetched.status })
  const res = fetched.res
  if (!res.ok) return NextResponse.json({ error: `الرابط رد بخطأ ${res.status}` }, { status: 502 })

  const ctype = (res.headers.get('content-type') || '').toLowerCase()
  if (ctype.startsWith('text/html')) {
    return NextResponse.json({ error: 'الرابط صفحة ويب لا ملف مباشر — إذا يطلب تسجيل/كلمة سر، حمّل الملف وارفعه يدوياً.' }, { status: 415 })
  }

  const buf = await readCapped(res, MAX_BYTES)
  if (buf === null) return NextResponse.json({ error: 'الملف أكبر من الحد المسموح (80MB)' }, { status: 413 })
  if (buf.byteLength === 0) return NextResponse.json({ error: 'الملف فارغ' }, { status: 422 })

  const name = filenameFrom(res, fetched.finalUrl)
  const contentType = ctype.split(';')[0] || 'application/octet-stream'
  if (!mimeAllowed(policy, contentType) && !mimeAllowed(policy, 'application/octet-stream')) {
    return NextResponse.json({ error: 'نوع الملف غير مسموح لهذه الوجهة' }, { status: 415 })
  }

  const rawFolder = typeof body.folder === 'string' ? body.folder.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) : ''
  const stem = safeNameStem(name)
  const ext = safeExtension(name)
  const key = `${kind}/${rawFolder || user.id}/link-${user.id.slice(0, 6)}-${stem}-${buf.byteLength}.${ext}`

  try {
    const up = await uploadBufferToS3({ buffer: buf, key, contentType })
    return NextResponse.json({ url: up.url, key: up.key, bytes: up.bytes, name })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'فشل الحفظ' }, { status: 500 })
  }
}
