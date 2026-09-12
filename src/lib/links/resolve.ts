// Turn ANY share link a client might send into the list of files behind it —
// or a precise reason why it can't be done without a person.
//
// Providers (all anonymous, no credentials ever stored, all via safe-fetch):
//   WeTransfer   we.tl / wetransfer.com/downloads   → v4 API: metadata (password?
//                expired?) then a signed direct link (zip when several files).
//   Google Drive file / Docs export / FOLDER (recursive, via the public
//                embedded folder view) — large-file "virus scan" confirm handled.
//   Dropbox      file or folder (?dl=1 → folder arrives as a zip).
//   OneDrive     1drv.ms / onedrive.live.com → shares API (file or folder).
//   SharePoint   "Anyone with the link" works (cookie handshake + REST folder
//                listing); links that bounce to a Microsoft sign-in are reported
//                as needsLogin — nobody can fetch those without the client's
//                account, and we do not ask for it.
//   GoFile       guest token + contents API (password-protected → reported).
//   MediaFire    download button on the page.
//   Mega         end-to-end encrypted — always manual.
//   Anything else: fetched as-is; a file is a file, an HTML page is reported.
//
// Only the URL classification is pure (tests); the rest talks to the network.

import { CookieJar, fetchText, safeFetch, isHtml } from './safe-fetch'

export interface RemoteFile {
  url: string
  /** Name when the provider tells us; else taken from the response. */
  name?: string
  headers?: Record<string, string>
  jar?: CookieJar
}

export type Resolution =
  | { status: 'files'; provider: string; files: RemoteFile[] }
  | { status: 'needsLogin' | 'password' | 'expired' | 'notFound' | 'page' | 'unsupported'; provider: string; message: string }

export type Provider = 'wetransfer' | 'gdrive' | 'dropbox' | 'onedrive' | 'sharepoint' | 'gofile' | 'mediafire' | 'mega' | 'direct'

const FOLDER_FILE_CAP = 200
const FOLDER_DEPTH = 3

export function classify(raw: string): { provider: Provider; url: URL } | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  const h = u.hostname.toLowerCase()
  if (h === 'we.tl' || h.endsWith('wetransfer.com')) return { provider: 'wetransfer', url: u }
  if (h.endsWith('drive.google.com') || h.endsWith('docs.google.com') || h.endsWith('drive.usercontent.google.com')) return { provider: 'gdrive', url: u }
  if (h.endsWith('dropbox.com')) return { provider: 'dropbox', url: u }
  if (h === '1drv.ms' || h.endsWith('onedrive.live.com') || h.endsWith('onedrive.com')) return { provider: 'onedrive', url: u }
  if (h.endsWith('.sharepoint.com')) return { provider: 'sharepoint', url: u }
  if (h.endsWith('gofile.io')) return { provider: 'gofile', url: u }
  if (h.endsWith('mediafire.com')) return { provider: 'mediafire', url: u }
  if (h.endsWith('mega.nz') || h.endsWith('mega.co.nz')) return { provider: 'mega', url: u }
  return { provider: 'direct', url: u }
}

const LOGIN_MARKERS = /login\.microsoftonline\.com|accounts\.google\.com\/(?:signin|v3\/signin|ServiceLogin)|dropbox\.com\/login|"isAnonymousGuestUser":false|name="loginfmt"|Sign in to your account|تسجيل الدخول إلى حسابك/i

function looksLikeLogin(hops: string[], html: string): boolean {
  return hops.some((h) => /login\.microsoftonline\.com|accounts\.google\.com|login\.live\.com/i.test(h)) || LOGIN_MARKERS.test(html)
}

// ─── WeTransfer ──────────────────────────────────────────────────────────────

async function resolveWeTransfer(u: URL): Promise<Resolution> {
  const provider = 'WeTransfer'
  let page = u.toString()
  if (u.hostname === 'we.tl') {
    const r = await safeFetch(page, { follow: false })
    if (!r.ok) return { status: 'page', provider, message: r.error }
    r.res.resume()
    const loc = r.res.headers.location
    if (!loc) return { status: 'notFound', provider, message: 'رابط we.tl لم يُحوّل — ربما انتهى' }
    page = new URL(loc, page).toString()
  }
  const m = /\/downloads\/([0-9a-f]{20,})(?:\/([0-9a-f]{20,}))?\/([0-9a-f]{4,})/i.exec(new URL(page).pathname)
  if (!m) return { status: 'page', provider, message: 'شكل رابط WeTransfer غير معروف — افتحه وحمّل' }
  const [, id, recipient, hash] = m
  const api = `https://wetransfer.com/api/v4/transfers/${id}`
  const jar = new CookieJar()
  const json = (o: Record<string, unknown>) => ({ method: 'POST' as const, jar, body: JSON.stringify(o), headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' } })
  const meta = await fetchText(`${api}/prepare-download`, json({ security_hash: hash, ...(recipient ? { recipient_id: recipient } : {}) }))
  let recommended: string | undefined
  if (meta.ok && meta.status === 200) {
    try {
      const j = JSON.parse(meta.text) as { state?: string; password_protected?: boolean; recommended_filename?: string; items?: Array<{ name: string }> }
      if (j.password_protected) return { status: 'password', provider, message: 'نقل WeTransfer محمي بكلمة مرور — افتحه بالكلمة وحمّل الملفات ثم ارفعها' }
      if (j.state && j.state !== 'downloadable') return { status: 'expired', provider, message: `نقل WeTransfer غير متاح (${j.state}) — انتهى أو حُذف؛ اطلب من العميل إعادة الإرسال` }
      recommended = j.recommended_filename || (j.items?.length === 1 ? j.items[0].name : undefined)
    } catch { /* fall through to the download call */ }
  } else if (meta.ok && (meta.status === 404 || meta.status === 410)) {
    return { status: 'expired', provider, message: 'نقل WeTransfer انتهى أو حُذف — اطلب من العميل إعادة الإرسال' }
  }
  const dl = await fetchText(`${api}/download`, json({ security_hash: hash, intent: 'entire_transfer', ...(recipient ? { recipient_id: recipient } : {}) }))
  if (!dl.ok) return { status: 'page', provider, message: dl.error }
  let direct: string | undefined
  try { direct = (JSON.parse(dl.text) as { direct_link?: string }).direct_link } catch { /* ignore */ }
  if (!direct) return { status: 'page', provider, message: `WeTransfer لم يعطِ رابط تحميل (HTTP ${dl.status}) — افتح الرابط وحمّل ثم ارفع` }
  return { status: 'files', provider, files: [{ url: direct, name: recommended }] }
}

// ─── Google Drive ────────────────────────────────────────────────────────────

function driveFileId(u: URL): string | null {
  const m = /\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([\w-]{10,})/.exec(u.pathname)
  if (m) return m[1]
  const id = u.searchParams.get('id')
  return id && /^[\w-]{10,}$/.test(id) ? id : null
}
function driveFolderId(u: URL): string | null {
  const m = /\/folders\/([\w-]{10,})/.exec(u.pathname)
  return m ? m[1] : (u.pathname.includes('embeddedfolderview') ? u.searchParams.get('id') : null)
}

async function listDriveFolder(id: string, depth: number, prefix: string, out: RemoteFile[]): Promise<'ok' | 'login' | 'notFound'> {
  const r = await fetchText(`https://drive.google.com/embeddedfolderview?id=${id}`)
  if (!r.ok) return 'notFound'
  if (r.status === 404) return 'notFound'
  if (r.status !== 200 || looksLikeLogin(r.hops, r.text)) return 'login'
  const entryRe = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?flip-entry-title">([^<]*)</g
  let m: RegExpExecArray | null
  const subs: Array<{ id: string; name: string }> = []
  while ((m = entryRe.exec(r.text)) !== null) {
    const [, eid, href, rawName] = m
    const name = rawName.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()
    if (/\/folders\//.test(href)) { subs.push({ id: eid, name }); continue }
    if (out.length >= FOLDER_FILE_CAP) break
    out.push(driveFile(eid, href, prefix ? `${prefix} › ${name}` : name))
  }
  if (depth < FOLDER_DEPTH) {
    for (const s of subs) {
      if (out.length >= FOLDER_FILE_CAP) break
      await listDriveFolder(s.id, depth + 1, prefix ? `${prefix} › ${s.name}` : s.name, out)
    }
  }
  return 'ok'
}

function driveFile(id: string, href: string, name?: string): RemoteFile {
  if (/docs\.google\.com\/spreadsheets/.test(href)) return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, name: name ? `${name}.xlsx` : undefined }
  if (/docs\.google\.com\/document/.test(href)) return { url: `https://docs.google.com/document/d/${id}/export?format=pdf`, name: name ? `${name}.pdf` : undefined }
  if (/docs\.google\.com\/presentation/.test(href)) return { url: `https://docs.google.com/presentation/d/${id}/export/pdf`, name: name ? `${name}.pdf` : undefined }
  return { url: `https://drive.google.com/uc?export=download&id=${id}`, name }
}

async function resolveDrive(u: URL): Promise<Resolution> {
  const provider = 'Google Drive'
  const folder = driveFolderId(u)
  if (folder) {
    const files: RemoteFile[] = []
    const st = await listDriveFolder(folder, 1, '', files)
    if (st === 'login') return { status: 'needsLogin', provider, message: 'مجلد Google Drive غير عام (يطلب تسجيل دخول) — افتحه وحمّل الملفات ثم ارفعها، أو اطلب من العميل جعله «لأي شخص لديه الرابط»' }
    if (st === 'notFound') return { status: 'notFound', provider, message: 'مجلد Google Drive غير موجود أو غير عام' }
    if (files.length === 0) return { status: 'notFound', provider, message: 'مجلد Google Drive فارغ' }
    return { status: 'files', provider, files }
  }
  const id = driveFileId(u)
  if (!id) return { status: 'page', provider, message: 'شكل رابط Google Drive غير معروف — افتحه وحمّل' }
  return { status: 'files', provider, files: [driveFile(id, u.toString())] }
}

/** Drive answers a large-file download with an HTML "can't scan for viruses"
 *  page carrying a form; submit it. Exported for the downloader. */
export function driveConfirmUrl(html: string): string | null {
  const form = /<form[^>]+action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html)
  if (!form) return null
  try {
    const u = new URL(form[1].replace(/&amp;/g, '&'), 'https://drive.usercontent.google.com')
    const inputRe = /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi
    let m: RegExpExecArray | null
    while ((m = inputRe.exec(form[2])) !== null) u.searchParams.set(m[1], m[2].replace(/&amp;/g, '&'))
    if (!u.searchParams.get('id')) return null
    return u.toString()
  } catch { return null }
}

// ─── Dropbox ─────────────────────────────────────────────────────────────────

function resolveDropbox(u: URL): Resolution {
  u.searchParams.set('dl', '1')
  return { status: 'files', provider: 'Dropbox', files: [{ url: u.toString() }] }
}

// ─── OneDrive (consumer) ─────────────────────────────────────────────────────

function shareId(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

async function resolveOneDrive(u: URL): Promise<Resolution> {
  const provider = 'OneDrive'
  const base = `https://api.onedrive.com/v1.0/shares/${shareId(u.toString())}`
  type Item = { name: string; file?: unknown; folder?: unknown; '@content.downloadUrl'?: string; id?: string }
  const root = await fetchText(`${base}/root?expand=children`, { headers: { Accept: 'application/json' } })
  if (!root.ok) return { status: 'page', provider, message: root.error }
  if (root.status === 401 || root.status === 403) return { status: 'needsLogin', provider, message: 'رابط OneDrive يطلب تسجيل دخول — افتحه وحمّل الملفات ثم ارفعها' }
  if (root.status === 404) return { status: 'notFound', provider, message: 'رابط OneDrive غير موجود أو انتهى' }
  if (root.status !== 200) return { status: 'page', provider, message: `OneDrive رد بـ ${root.status} — افتح الرابط وحمّل ثم ارفع` }
  let j: Item & { children?: Item[] }
  try { j = JSON.parse(root.text) } catch { return { status: 'page', provider, message: 'رد OneDrive غير مفهوم — افتح الرابط وحمّل' } }
  if (j.file && j['@content.downloadUrl']) return { status: 'files', provider, files: [{ url: j['@content.downloadUrl'], name: j.name }] }
  const files: RemoteFile[] = []
  const walk = async (items: Item[] | undefined, prefix: string, depth: number) => {
    for (const it of items || []) {
      if (files.length >= FOLDER_FILE_CAP) return
      const label = prefix ? `${prefix} › ${it.name}` : it.name
      if (it.file && it['@content.downloadUrl']) files.push({ url: it['@content.downloadUrl'], name: label })
      else if (it.folder && it.id && depth < FOLDER_DEPTH) {
        const sub = await fetchText(`${base}/items/${it.id}/children`, { headers: { Accept: 'application/json' } })
        if (sub.ok && sub.status === 200) { try { await walk((JSON.parse(sub.text) as { value?: Item[] }).value, label, depth + 1) } catch { /* skip */ } }
      }
    }
  }
  await walk(j.children, '', 1)
  if (files.length === 0) return { status: 'notFound', provider, message: 'مجلد OneDrive فارغ أو غير قابل للقراءة' }
  return { status: 'files', provider, files }
}

// ─── SharePoint (business OneDrive) ──────────────────────────────────────────

async function resolveSharePoint(u: URL): Promise<Resolution> {
  const provider = 'SharePoint'
  const jar = new CookieJar()
  const isFile = /\/:[xbwupt]:\//.test(u.pathname)
  const isFolder = /\/:f:\//.test(u.pathname)
  const start = new URL(u.toString())
  if (isFile) start.searchParams.set('download', '1')
  const r = await safeFetch(start.toString(), { jar })
  if (!r.ok) return { status: 'page', provider, message: r.error }
  const ctype = String(r.res.headers['content-type'] || '')
  const status = r.res.statusCode || 0
  if (isFile && status === 200 && !isHtml(ctype)) {
    return { status: 'files', provider, files: [{ url: start.toString(), jar }] }
  }
  // Read the page (small) to decide: sign-in bounce vs anonymous session.
  const chunks: Buffer[] = []
  let total = 0
  await new Promise<void>((resolve) => {
    r.res.on('data', (c: Buffer) => { total += c.length; if (total < 512 * 1024) chunks.push(c); else r.res.destroy() })
    r.res.on('end', resolve); r.res.on('close', resolve); r.res.on('error', () => resolve())
  })
  const html = Buffer.concat(chunks).toString('utf8')
  if (looksLikeLogin(r.hops, html) || !jar.has(u.hostname, 'FedAuth')) {
    return { status: 'needsLogin', provider, message: 'رابط SharePoint يطلب تسجيل دخول مايكروسوفت (ليس عاماً) — افتحه بحساب مخوَّل، حمّل الملفات، ثم أضفها هنا' }
  }
  if (status === 404) return { status: 'notFound', provider, message: 'رابط SharePoint غير موجود أو انتهى' }
  if (!isFolder) return { status: 'page', provider, message: 'شكل رابط SharePoint غير معروف — افتحه وحمّل ثم ارفع' }

  // Anonymous folder session: the final URL carries the server-relative path.
  const final = new URL(r.finalUrl)
  const rel = final.searchParams.get('id') || (/"listUrl":"([^"]+)"/.exec(html)?.[1] ?? null)
  const site = /^\/(personal|sites|teams)\/[^/]+/.exec(final.pathname)?.[0] || /^\/(personal|sites|teams)\/[^/]+/.exec(rel || '')?.[0] || ''
  if (!rel) return { status: 'page', provider, message: 'تعذّر تحديد مسار المجلد في SharePoint — افتحه وحمّل ثم ارفع' }
  const apiBase = `https://${u.hostname}${site}/_api/web`
  const files: RemoteFile[] = []
  const list = async (folderRel: string, prefix: string, depth: number) => {
    const q = (kind: 'Files' | 'Folders') => `${apiBase}/GetFolderByServerRelativeUrl('${encodeURIComponent(folderRel).replace(/'/g, "''")}')/${kind}?$select=Name,ServerRelativeUrl,Length`
    const fr = await fetchText(q('Files'), { jar, headers: { Accept: 'application/json;odata=nometadata' } })
    if (fr.ok && fr.status === 200) {
      try {
        for (const f of (JSON.parse(fr.text) as { value?: Array<{ Name: string; ServerRelativeUrl: string }> }).value || []) {
          if (files.length >= FOLDER_FILE_CAP) return
          files.push({ url: `https://${u.hostname}${f.ServerRelativeUrl.split('/').map(encodeURIComponent).join('/')}`, name: prefix ? `${prefix} › ${f.Name}` : f.Name, jar })
        }
      } catch { /* ignore */ }
    }
    if (depth >= FOLDER_DEPTH) return
    const dr = await fetchText(q('Folders'), { jar, headers: { Accept: 'application/json;odata=nometadata' } })
    if (dr.ok && dr.status === 200) {
      try {
        for (const d of (JSON.parse(dr.text) as { value?: Array<{ Name: string; ServerRelativeUrl: string }> }).value || []) {
          if (d.Name === 'Forms') continue
          await list(d.ServerRelativeUrl, prefix ? `${prefix} › ${d.Name}` : d.Name, depth + 1)
        }
      } catch { /* ignore */ }
    }
  }
  await list(rel, '', 1)
  if (files.length === 0) return { status: 'page', provider, message: 'تعذّر قراءة محتويات مجلد SharePoint — افتحه وحمّل الملفات ثم أضفها هنا' }
  return { status: 'files', provider, files }
}

// ─── GoFile ──────────────────────────────────────────────────────────────────

async function resolveGoFile(u: URL): Promise<Resolution> {
  const provider = 'GoFile'
  const id = /\/d\/([\w-]+)/.exec(u.pathname)?.[1] || u.searchParams.get('c')
  if (!id) return { status: 'page', provider, message: 'شكل رابط GoFile غير معروف — افتحه وحمّل' }
  const acc = await fetchText('https://api.gofile.io/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  let token = ''
  try { token = acc.ok ? String((JSON.parse(acc.text) as { data?: { token?: string } }).data?.token || '') : '' } catch { /* ignore */ }
  if (!token) return { status: 'page', provider, message: 'GoFile لم يعطِ جلسة ضيف — افتح الرابط وحمّل ثم ارفع' }
  const jar = new CookieJar()
  jar.absorb('gofile.io', `accountToken=${token}`)
  jar.absorb(u.hostname, `accountToken=${token}`)
  const c = await fetchText(`https://api.gofile.io/contents/${id}?wt=4fd6sg89d7s6&cache=true`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!c.ok) return { status: 'page', provider, message: c.error }
  let j: { status?: string; data?: { password?: boolean; passwordStatus?: string; children?: Record<string, { type: string; name: string; link?: string; children?: Record<string, unknown> }> } }
  try { j = JSON.parse(c.text) } catch { return { status: 'page', provider, message: 'رد GoFile غير مفهوم — افتح الرابط وحمّل' } }
  if (j.status && j.status !== 'ok') {
    if (/password/i.test(j.status) || j.data?.passwordStatus === 'passwordRequired') return { status: 'password', provider, message: 'مجلد GoFile محمي بكلمة مرور — افتحه بالكلمة وحمّل ثم ارفع' }
    if (/notFound/i.test(j.status)) return { status: 'notFound', provider, message: 'رابط GoFile غير موجود أو انتهى' }
    return { status: 'page', provider, message: `GoFile: ${j.status} — افتح الرابط وحمّل ثم ارفع` }
  }
  const files: RemoteFile[] = []
  for (const ch of Object.values(j.data?.children || {})) {
    if (ch.type === 'file' && ch.link) files.push({ url: ch.link, name: ch.name, jar })
    if (files.length >= FOLDER_FILE_CAP) break
  }
  if (files.length === 0) return { status: 'notFound', provider, message: 'مجلد GoFile فارغ' }
  return { status: 'files', provider, files }
}

// ─── MediaFire ───────────────────────────────────────────────────────────────

async function resolveMediaFire(u: URL): Promise<Resolution> {
  const provider = 'MediaFire'
  const r = await fetchText(u.toString())
  if (!r.ok) return { status: 'page', provider, message: r.error }
  const m = /href="(https:\/\/download\d*\.mediafire\.com\/[^"]+)"/.exec(r.text)
  if (!m) return { status: 'page', provider, message: 'تعذّر إيجاد زر التحميل في MediaFire — افتح الرابط وحمّل' }
  return { status: 'files', provider, files: [{ url: m[1].replace(/&amp;/g, '&') }] }
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export async function resolveLink(raw: string): Promise<Resolution> {
  const c = classify(raw)
  if (!c) return { status: 'unsupported', provider: '—', message: 'رابط غير صالح' }
  const { provider, url } = c
  try {
    switch (provider) {
      case 'wetransfer': return await resolveWeTransfer(url)
      case 'gdrive': return await resolveDrive(url)
      case 'dropbox': return resolveDropbox(url)
      case 'onedrive': return await resolveOneDrive(url)
      case 'sharepoint': return await resolveSharePoint(url)
      case 'gofile': return await resolveGoFile(url)
      case 'mediafire': return await resolveMediaFire(url)
      case 'mega': return { status: 'unsupported', provider: 'Mega', message: 'Mega مشفّر من طرف إلى طرف — افتح الرابط وحمّل الملفات ثم ارفعها' }
      default: return { status: 'files', provider: url.hostname, files: [{ url: url.toString() }] }
    }
  } catch (e) {
    return { status: 'page', provider, message: `تعذّر قراءة الرابط — ${e instanceof Error ? e.message : 'خطأ'}` }
  }
}

export { looksLikeLogin }
