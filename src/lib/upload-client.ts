'use client'

// One upload call for the whole app, big-file safe AND hang-proof.
//
// Tries the DIRECT path first: ask the server for a signed URL, then PUT the
// file straight to S3. The bytes bypass nginx entirely, so the 413 that kills
// large uploads (company profiles, drawing sets, big scans) simply cannot happen.
//
// If presigning isn't available (bucket CORS not set yet, older deploy), it
// falls back to the classic POST /api/upload so nothing regresses — that path
// still works for everything under the proxy's limit.
//
// Every network call is wrapped in an AbortController timeout, so a stalled
// socket can NEVER leave the caller's spinner turning forever. On timeout we
// throw a clear message instead of hanging.

export interface UploadedFileResult {
  url: string
  key: string
  bytes: number
  name: string
}

const PRESIGN_TIMEOUT_MS = 25_000       // asking for a signed URL is a tiny request
const TRANSFER_TIMEOUT_MS = 5 * 60_000  // the actual bytes — generous, but never infinite
// Above this, the classic (nginx) path will almost certainly 413, so a failed
// DIRECT upload shouldn't waste minutes re-sending through it — fail fast instead.
const CLASSIC_MAX_BYTES = 10 * 1024 * 1024

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string })?.name === 'AbortError'
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function classicUpload(file: File, kind: string, folder?: string): Promise<UploadedFileResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  if (folder) fd.append('folder', folder)

  let res: Response
  try {
    res = await fetchWithTimeout('/api/upload', { method: 'POST', body: fd }, TRANSFER_TIMEOUT_MS)
  } catch (e) {
    if (isAbort(e)) {
      throw new Error(`الرفع تجاوز المهلة (${Math.round(TRANSFER_TIMEOUT_MS / 60000)} دقائق) — الملف كبير أو الاتصال بطيء. حاول مرة ثانية.`)
    }
    throw new Error('تعذّر الوصول للخادم — تأكد من الاتصال بالإنترنت.')
  }

  if (res.status === 413) {
    throw new Error(
      `الملف كبير (${Math.round(file.size / 1024 / 1024)}MB) وتعذّر الرفع المباشر لأمازون. ` +
      `عادةً يُضبط CORS تلقائياً — إذا تكرر، تأكد أن مستخدم AWS عنده صلاحية s3:PutBucketCors و s3:GetBucketCors.`,
    )
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.url) throw new Error(j.error || 'فشل الرفع')
  return { url: j.url, key: j.key, bytes: j.bytes ?? file.size, name: file.name }
}

export async function uploadFile(
  file: File,
  kind: string,
  folder?: string,
): Promise<UploadedFileResult> {
  const contentType = file.type || 'application/octet-stream'

  // 1) Ask for a signed URL. A non-OK answer here is a POLICY refusal (bad kind,
  //    wrong type, not super-admin) — surface it instead of silently retrying.
  let signed: { uploadUrl: string; key: string; url: string } | null = null
  try {
    const res = await fetchWithTimeout('/api/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, filename: file.name, contentType, folder }),
    }, PRESIGN_TIMEOUT_MS)
    if (res.status === 400 || res.status === 403 || res.status === 415) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || 'نوع الملف غير مسموح')
    }
    if (res.ok) {
      const j = await res.json().catch(() => ({} as { uploadUrl?: string; url?: string; key?: string }))
      if (j?.uploadUrl && j?.url) signed = j as { uploadUrl: string; key: string; url: string }
    }
  } catch (e) {
    // A policy refusal must not fall through to the classic path (it would just
    // be refused again, with a worse message). A network/timeout blip on the
    // tiny presign call, though, is fine to retry via the classic path.
    if (e instanceof Error && e.message && !isAbort(e) && !/fetch|network/i.test(e.message)) throw e
  }

  // 2) Direct PUT to S3 — the file never touches our server.
  //
  // If S3 ANSWERS but refuses (403 signature, 400 bad request), that is a real
  // configuration fault: report it verbatim. Silently falling back here is what
  // made a past bug invisible — the user saw a confusing "file too large /
  // enable CORS" 413 when the actual problem was a bad signature.
  if (signed) {
    let reached = false
    try {
      const put = await fetchWithTimeout(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      }, TRANSFER_TIMEOUT_MS)
      reached = true
      if (put.ok) {
        return { url: signed.url, key: signed.key, bytes: file.size, name: file.name }
      }
      const detail = await put.text().catch(() => '')
      const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1] || ''
      throw new Error(
        `أمازون S3 رفض الرفع (${put.status}${code ? ` ${code}` : ''}). ` +
        (code === 'AccessDenied'
          ? 'تأكد أن مستخدم AWS عنده صلاحية s3:PutObject على المخزن.'
          : 'راجع إعدادات المخزن.'),
      )
    } catch (e) {
      // A timeout on the direct PUT is terminal — retrying the same big file
      // through nginx would only stall again, so surface it clearly.
      if (isAbort(e)) {
        throw new Error(`الرفع تجاوز المهلة (${Math.round(TRANSFER_TIMEOUT_MS / 60000)} دقائق) — الاتصال بطيء أو الملف ضخم. حاول مرة ثانية.`)
      }
      // Only a genuine "couldn't reach S3 at all" (CORS preflight blocked, no
      // network) is worth retrying through our own server.
      if (reached) throw e
    }
  }

  // We HAD a signed URL but couldn't reach S3 directly. The classic path streams
  // the whole file through nginx and will almost certainly 413 a large one after
  // minutes of waiting — fail fast with a clear message instead of a doomed retry.
  if (signed && file.size > CLASSIC_MAX_BYTES) {
    throw new Error(
      `تعذّر الرفع المباشر لأمازون والملف كبير (${Math.round(file.size / 1024 / 1024)}MB). ` +
      `تأكد من صلاحيات S3/CORS للمخزن ثم أعد المحاولة.`,
    )
  }

  return classicUpload(file, kind, folder)
}
