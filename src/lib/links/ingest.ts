// One call: share link in → files in OUR S3 out.
//
//   resolveLink  → the remote files behind the link (or why not)
//   download     → each through the SSRF-safe fetcher, streaming size cap
//   archives     → ZIP / RAR opened in memory, entries become files
//                  (one level of nesting: a zip inside the rar is opened too)
//   upload       → app-owned S3 keys, same shape the upload flow returns
//
// Everything that could not be done is a human sentence in `notices`; the
// caller shows them. A link that needs a person (sign-in, password) comes back
// as `status` with no files, never as a silent zero.

import { uploadBufferToS3, safeExtension, safeNameStem } from '@/lib/s3'
import { policyFor, mimeAllowed } from '@/lib/upload-policy'
import { safeFetch, readCapped, filenameFrom, isHtml } from './safe-fetch'
import { resolveLink, driveConfirmUrl, looksLikeLogin, type RemoteFile, type Resolution } from './resolve'
import { archiveKind, extractArchive } from './archive'

export const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024
const MAX_FILES_PER_LINK = 250

export interface IngestedFile { url: string; key: string; bytes: number; name: string }
export interface IngestResult {
  status: Resolution['status']
  provider: string
  message?: string
  files: IngestedFile[]
  notices: string[]
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}
function mimeFor(name: string, declared?: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return MIME_BY_EXT[ext] || (declared && !/octet-stream|binary/.test(declared) ? declared : 'application/octet-stream')
}

async function download(f: RemoteFile): Promise<{ ok: true; name: string; buf: Buffer; contentType: string } | { ok: false; error: string }> {
  let r = await safeFetch(f.url, { jar: f.jar, headers: f.headers })
  if (!r.ok) return { ok: false, error: r.error }
  let status = r.res.statusCode || 0
  let ctype = String(r.res.headers['content-type'] || '').toLowerCase()
  // Google Drive's virus-scan interstitial for big files: submit its form once.
  if (status === 200 && isHtml(ctype) && /google\.com/.test(f.url)) {
    const html = (await readCapped(r.res, 2 * 1024 * 1024))?.toString('utf8') || ''
    const next = driveConfirmUrl(html)
    if (!next) return { ok: false, error: looksLikeLogin(r.hops, html) ? 'يطلب تسجيل دخول Google (الملف غير عام)' : 'Google Drive رد بصفحة بدل الملف' }
    r = await safeFetch(next, { jar: f.jar })
    if (!r.ok) return { ok: false, error: r.error }
    status = r.res.statusCode || 0
    ctype = String(r.res.headers['content-type'] || '').toLowerCase()
  }
  if (status < 200 || status >= 300) { r.res.resume(); return { ok: false, error: `الرابط رد بخطأ ${status}` } }
  if (isHtml(ctype) && !/attachment/i.test(String(r.res.headers['content-disposition'] || ''))) {
    const html = (await readCapped(r.res, 512 * 1024))?.toString('utf8') || ''
    return { ok: false, error: looksLikeLogin(r.hops, html) ? 'يطلب تسجيل دخول' : 'الرابط صفحة ويب لا ملف مباشر' }
  }
  const declared = Number(r.res.headers['content-length'] || 0)
  if (declared > MAX_DOWNLOAD_BYTES) { r.res.destroy(); return { ok: false, error: `أكبر من الحد (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)}MB)` } }
  const buf = await readCapped(r.res, MAX_DOWNLOAD_BYTES)
  if (buf === null) return { ok: false, error: `أكبر من الحد (${Math.round(MAX_DOWNLOAD_BYTES / 1048576)}MB)` }
  if (buf.byteLength === 0) return { ok: false, error: 'الملف فارغ' }
  const name = f.name || filenameFrom(r.res.headers, r.finalUrl)
  return { ok: true, name, buf, contentType: ctype.split(';')[0] }
}

export interface IngestOptions {
  url: string
  /** Upload policy kind (furn / projects …). */
  kind: string
  userId: string
  /** S3 folder segment (project id); defaults to the user id. */
  folder?: string
}

export async function ingestLink(o: IngestOptions): Promise<IngestResult> {
  const policy = policyFor(o.kind)
  if (!policy) return { status: 'unsupported', provider: '—', message: 'Invalid kind', files: [], notices: [] }
  const res = await resolveLink(o.url)
  if (res.status !== 'files') return { status: res.status, provider: res.provider, message: res.message, files: [], notices: [] }

  const files: IngestedFile[] = []
  const notices: string[] = []
  const folder = (o.folder || o.userId).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || o.userId
  const seenKeys = new Set<string>()

  const store = async (name: string, data: Uint8Array, declaredType?: string) => {
    if (files.length >= MAX_FILES_PER_LINK) { notices.push(`تجاوز الرابط ${MAX_FILES_PER_LINK} ملف — أُخذت الأوائل`); return }
    const contentType = mimeFor(name, declaredType)
    if (!mimeAllowed(policy, contentType) && !mimeAllowed(policy, 'application/octet-stream')) { notices.push(`تخطّي «${name}» — نوع غير مسموح`); return }
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const key = `${o.kind}/${folder}/link-${o.userId.slice(0, 6)}-${safeNameStem(name)}-${buffer.byteLength}.${safeExtension(name)}`
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    const up = await uploadBufferToS3({ buffer, key, contentType })
    files.push({ url: up.url, key: up.key, bytes: up.bytes, name })
  }

  // Archives: open, keep the folder context in names, one nested level.
  const unpack = async (name: string, data: Uint8Array, depth: number): Promise<boolean> => {
    const kind = archiveKind(name, data)
    if (!kind) return false
    let out
    try {
      out = await extractArchive(kind, data, async (en) => {
        const inner = depth < 2 && (await unpack(en.name, en.data, depth + 1))
        if (!inner) await store(en.name, en.data)
      })
    } catch (e) { notices.push(`«${name}»: ${e instanceof Error ? e.message : 'تعذّر الفتح'}`); return true }
    notices.push(...out.notices)
    if (out.count === 0) notices.push(`«${name}» أرشيف فارغ`)
    return true
  }

  for (const rf of res.files) {
    const d = await download(rf)
    if (!d.ok) { notices.push(`${rf.name || rf.url.split('/').pop() || 'ملف'}: ${d.error}`); continue }
    const opened = await unpack(d.name, d.buf, 1)
    if (!opened) await store(d.name, d.buf, d.contentType)
  }

  if (files.length === 0) {
    return { status: 'page', provider: res.provider, message: notices[0] || 'لم يُجلب أي ملف', files, notices }
  }
  return { status: 'files', provider: res.provider, files, notices }
}
