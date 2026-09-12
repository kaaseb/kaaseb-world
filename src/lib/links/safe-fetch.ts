// SSRF-safe HTTP for server-side fetching of ARBITRARY external URLs (cloud
// share links the client sent). Shared by /api/fetch-link and the link
// resolvers — one guard, one place.
//
// The guard PINS the resolved IP: a custom DNS `lookup` resolves the host,
// rejects the request if ANY resolved address is private/internal, and hands
// the SAME validated IP to the socket. Validation and connection use one
// resolution, so there is no DNS-rebinding window. Redirects are followed
// MANUALLY so each hop is re-validated, and bodies are size-capped WHILE
// streaming so a chunked response can't blow past the cap into memory.
//
// A tiny per-host cookie jar rides along: anonymous SharePoint links hand out
// a session cookie on the first hop that the file download needs. Cookies never
// leave the host that set them and never outlive the call.

import net from 'net'
import dns from 'dns'
import http from 'http'
import https from 'https'
import type { LookupFunction } from 'net'

export const DEFAULT_TIMEOUT_MS = 60_000
const MAX_HOPS = 8
// A browser-like UA: several share hosts serve bots a stub page instead of the
// real one. We identify ourselves in the `From`-style header instead.
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 KaasebBot/1.0'

// ─── IP classification ───────────────────────────────────────────────────────

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
  if (n === null) return true
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
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip)
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true
    if (/^f[cd]/.test(low)) return true
    if (/^fe[89ab]/.test(low)) return true
    const mapped = low.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIpv4(mapped[1])
    return false
  }
  return true
}

// Node ≥ 20 (autoSelectFamily) calls the lookup with `all: true` and expects an
// ARRAY of validated addresses; older callers expect one. Serve both — every
// address handed back has been checked, so whichever the socket picks is safe.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  const opts = options && typeof options === 'object' ? (options as dns.LookupOptions) : {}
  const family = Number(opts.family) || 0
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) { callback(err, '', 0); return }
    let list = addresses as dns.LookupAddress[]
    if (family === 4 || family === 6) list = list.filter((a) => a.family === family)
    const publics = list.filter((a) => !isPrivateIp(a.address))
    if (publics.length === 0) { callback(new Error('blocked: resolves to a private/internal address'), '', 0); return }
    if (opts.all) { (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, publics); return }
    callback(null, publics[0].address, publics[0].family)
  })
}

// ─── Cookie jar (per host, per call) ─────────────────────────────────────────

export class CookieJar {
  private byHost = new Map<string, Map<string, string>>()
  absorb(host: string, setCookie: string[] | string | undefined) {
    if (!setCookie) return
    const list = Array.isArray(setCookie) ? setCookie : [setCookie]
    const m = this.byHost.get(host) || new Map<string, string>()
    for (const raw of list) {
      const first = raw.split(';')[0]
      const eq = first.indexOf('=')
      if (eq <= 0) continue
      m.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim())
    }
    this.byHost.set(host, m)
  }
  header(host: string): string | undefined {
    const m = this.byHost.get(host)
    if (!m || m.size === 0) return undefined
    return Array.from(m, ([k, v]) => `${k}=${v}`).join('; ')
  }
  has(host: string, name: string): boolean { return !!this.byHost.get(host)?.has(name) }
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  jar?: CookieJar
  /** false → return the 3xx as-is (callers that only want the Location). */
  follow?: boolean
  timeoutMs?: number
}

export type SafeFetchResult =
  | { ok: true; res: http.IncomingMessage; finalUrl: string; hops: string[] }
  | { ok: false; error: string; status: number }

function requestOnce(u: URL, o: FetchOptions): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http
    const headers: Record<string, string> = { 'User-Agent': BROWSER_UA, Accept: '*/*', ...(o.headers || {}) }
    const cookie = o.jar?.header(u.hostname)
    if (cookie) headers.Cookie = cookie
    if (o.body) headers['Content-Length'] = String(Buffer.byteLength(o.body))
    const req = mod.request(u, { method: o.method || 'GET', lookup: safeLookup, headers }, resolve)
    req.setTimeout(o.timeoutMs || DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (o.body) req.write(o.body)
    req.end()
  })
}

/** Manual-redirect fetch: every hop goes through the pinning lookup. */
export async function safeFetch(startUrl: string, o: FetchOptions = {}): Promise<SafeFetchResult> {
  let url = startUrl
  let method = o.method || 'GET'
  let body = o.body
  const hops: string[] = []
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, error: 'رابط غير صالح', status: 400 } }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'يُسمح بروابط http/https فقط', status: 400 }
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return { ok: false, error: 'هذا العنوان غير مسموح', status: 400 }

    let res: http.IncomingMessage
    try {
      res = await requestOnce(u, { ...o, method, body })
    } catch (e) {
      return { ok: false, error: `تعذّر الوصول للرابط: ${e instanceof Error ? e.message : 'فشل'}`, status: 502 }
    }
    o.jar?.absorb(u.hostname, res.headers['set-cookie'])
    hops.push(u.toString())

    const status = res.statusCode || 0
    if (status >= 300 && status < 400 && res.headers.location && o.follow !== false) {
      res.resume()
      try { url = new URL(res.headers.location, u).toString() } catch { return { ok: false, error: 'وجهة إعادة التوجيه غير صالحة', status: 502 } }
      if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) { method = 'GET'; body = undefined }
      continue
    }
    return { ok: true, res, finalUrl: u.toString(), hops }
  }
  return { ok: false, error: 'تحويلات كثيرة جداً', status: 502 }
}

/** Read the body with the cap enforced WHILE streaming (null = over the cap). */
export function readCapped(res: http.IncomingMessage, max: number): Promise<Buffer | null> {
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

const TEXT_CAP = 3 * 1024 * 1024

/** Small text/JSON GET or POST (pages, APIs) — capped at 3MB. */
export async function fetchText(url: string, o: FetchOptions = {}): Promise<{ ok: true; status: number; text: string; finalUrl: string; hops: string[]; contentType: string } | { ok: false; error: string; status: number }> {
  const r = await safeFetch(url, o)
  if (!r.ok) return r
  const buf = await readCapped(r.res, TEXT_CAP)
  if (buf === null) return { ok: false, error: 'الصفحة أكبر من المتوقع', status: 502 }
  return { ok: true, status: r.res.statusCode || 0, text: buf.toString('utf8'), finalUrl: r.finalUrl, hops: r.hops, contentType: String(r.res.headers['content-type'] || '') }
}

export function filenameFrom(headers: http.IncomingHttpHeaders, url: string): string {
  const cd = (headers['content-disposition'] as string) || ''
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(cd)
  if (star?.[1]) { try { return decodeURIComponent(star[1].trim()) } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/.exec(cd)
  if (plain?.[1]) { try { return decodeURIComponent(plain[1].trim()) } catch { return plain[1].trim() } }
  try { const p = new URL(url).pathname.split('/').filter(Boolean).pop(); if (p) return decodeURIComponent(p) } catch { /* ignore */ }
  return 'file'
}

export function isHtml(contentType: string | undefined): boolean {
  return (contentType || '').toLowerCase().startsWith('text/html')
}
