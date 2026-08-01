// POST /api/fetch-link — download a file from a PUBLIC cloud link and store it
// in S3, returning it in the same shape the upload flow uses so the form can
// drop it into a file bucket.
//
// Scope (your decision): PUBLIC DIRECT links only — no password/OTP automation.
// Common share links that resolve to a direct download are transformed here
// (Google Drive, Dropbox). Anything needing a login/OTP is out.
//
// SSRF: this fetches an ARBITRARY external URL server-side. The guard PINS the
// resolved IP — a custom DNS `lookup` resolves the host, rejects the request if
// ANY resolved address is private/internal, and hands the SAME validated IP to
// the socket. Because validation and connection use one resolution, there is no
// DNS-rebinding window (the classic resolve-then-fetch TOCTOU where the fetch
// re-resolves to an internal IP is closed). Redirects are followed MANUALLY so
// each hop is re-validated, and the body is size-capped WHILE streaming so a
// chunked response can't blow past the cap into memory. Gated on a real intake
// permission.

import net from 'net'
import dns from 'dns'
import http from 'http'
import https from 'https'
import type { LookupFunction } from 'net'
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

// ─── SSRF: classify an IP as private/internal ────────────────────────────────

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

// Pinning lookup: resolve ALL addresses (this normalises decimal/hex/octal/IPv6
// encodings too), reject if any is private, and return exactly one validated
// public IP — which is the address the socket then connects to. No second,
// unvalidated resolution happens, so a rebind between check and connect is
// impossible.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  const family = (options && typeof options === 'object' ? (options as dns.LookupOptions).family : 0) || 0
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) { callback(err, '', 0); return }
    let list = addresses as dns.LookupAddress[]
    if (family === 4 || family === 6) list = list.filter((a) => a.family === family)
    const publics = list.filter((a) => !isPrivateIp(a.address))
    if (publics.length === 0) { callback(new Error('blocked: resolves to a private/internal address'), '', 0); return }
    callback(null, publics[0].address, publics[0].family)
  })
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

function filenameFrom(headers: http.IncomingHttpHeaders, url: string): string {
  const cd = (headers['content-disposition'] as string) || ''
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  if (m && m[1]) { try { return decodeURIComponent(m[1].trim()) } catch { return m[1].trim() } }
  try { const p = new URL(url).pathname.split('/').filter(Boolean).pop(); if (p) return decodeURIComponent(p) } catch { /* ignore */ }
  return 'file'
}

// One request through the pinning lookup; resolves to the raw response stream.
function requestOnce(u: URL): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, {
      method: 'GET',
      lookup: safeLookup,
      headers: { 'User-Agent': 'KaasebBot/1.0', Accept: '*/*' },
    }, resolve)
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

// Manual-redirect fetch: every hop goes through the pinning lookup.
async function safeFetch(startUrl: string): Promise<{ ok: true; res: http.IncomingMessage; finalUrl: string } | { ok: false; error: string; status: number }> {
  let url = startUrl
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, error: 'رابط غير صالح', status: 400 } }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'يُسمح بروابط http/https فقط', status: 400 }
    // Fast-fail for a literal private IP in the URL; DNS hostnames are validated
    // at connect time by safeLookup (which pins the IP — no re-resolution).
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return { ok: false, error: 'هذا العنوان غير مسموح', status: 400 }

    let res: http.IncomingMessage
    try {
      res = await requestOnce(u)
    } catch (e) {
      // A blocked internal address surfaces here as a connect error.
      return { ok: false, error: `تعذّر الوصول للرابط: ${e instanceof Error ? e.message : 'فشل'}`, status: 502 }
    }

    const status = res.statusCode || 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume() // drain & free the socket before the next hop
      try { url = new URL(res.headers.location, u).toString() } catch { return { ok: false, error: 'وجهة إعادة التوجيه غير صالحة', status: 502 } }
      continue
    }
    return { ok: true, res, finalUrl: u.toString() }
  }
  return { ok: false, error: 'تحويلات كثيرة جداً', status: 502 }
}

// Read the body with the cap enforced WHILE streaming (null = over the cap).
function readCapped(res: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    res.on('data', (c: Buffer) => {
      total += c.length
      if (total > max) { res.destroy(); resolve(null); return }
      chunks.push(c)
    })
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  })
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

  const status = res.statusCode || 0
  if (status < 200 || status >= 300) {
    res.resume()
    return NextResponse.json({ error: `الرابط رد بخطأ ${status}` }, { status: 502 })
  }

  const ctypeHeader = ((res.headers['content-type'] as string) || '').toLowerCase()
  if (ctypeHeader.startsWith('text/html')) {
    res.resume()
    return NextResponse.json({ error: 'الرابط صفحة ويب لا ملف مباشر — إذا يطلب تسجيل/كلمة سر، حمّل الملف وارفعه يدوياً.' }, { status: 415 })
  }
  // Early reject on a declared over-limit size (streaming cap still guards the rest).
  const declared = Number(res.headers['content-length'] || 0)
  if (declared && declared > MAX_BYTES) {
    res.destroy()
    return NextResponse.json({ error: 'الملف أكبر من الحد المسموح (80MB)' }, { status: 413 })
  }

  const buf = await readCapped(res, MAX_BYTES)
  if (buf === null) return NextResponse.json({ error: 'الملف أكبر من الحد المسموح (80MB)' }, { status: 413 })
  if (buf.byteLength === 0) return NextResponse.json({ error: 'الملف فارغ' }, { status: 422 })

  const name = filenameFrom(res.headers, fetched.finalUrl)
  const contentType = ctypeHeader.split(';')[0] || 'application/octet-stream'
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
