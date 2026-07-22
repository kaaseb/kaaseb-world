'use client'

// One upload call for the whole app, big-file safe.
//
// Tries the DIRECT path first: ask the server for a signed URL, then PUT the
// file straight to S3. The bytes bypass nginx entirely, so the 413 that kills
// large uploads (company profiles, drawing sets) simply cannot happen.
//
// If presigning isn't available (bucket CORS not set yet, older deploy), it
// falls back to the classic POST /api/upload so nothing regresses — that path
// still works for everything under the proxy's limit.

export interface UploadedFileResult {
  url: string
  key: string
  bytes: number
  name: string
}

async function classicUpload(file: File, kind: string, folder?: string): Promise<UploadedFileResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  if (folder) fd.append('folder', folder)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (res.status === 413) {
    throw new Error(
      `الملف كبير على الخادم (${Math.round(file.size / 1024 / 1024)}MB) والرفع المباشر غير مفعّل. فعّل CORS للمخزن من الإعدادات ثم أعد المحاولة.`,
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
    const res = await fetch('/api/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, filename: file.name, contentType, folder }),
    })
    if (res.status === 400 || res.status === 403 || res.status === 415) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error || 'نوع الملف غير مسموح')
    }
    if (res.ok) {
      const j = await res.json()
      if (j?.uploadUrl && j?.url) signed = j
    }
  } catch (e) {
    // A policy refusal must not fall through to the classic path (it would just
    // be refused again, with a worse message).
    if (e instanceof Error && e.message && !/fetch|network/i.test(e.message)) throw e
  }

  // 2) Direct PUT to S3 — the file never touches our server.
  //
  // If S3 ANSWERS but refuses (403 signature, 400 bad request), that is a real
  // configuration fault: report it verbatim. Silently falling back here is what
  // made the last bug invisible — the user saw a confusing "file too large /
  // enable CORS" 413 when the actual problem was a bad signature.
  if (signed) {
    let reached = false
    try {
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
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
      // Only a genuine "couldn't reach S3 at all" (CORS preflight blocked, no
      // network) is worth retrying through our own server.
      if (reached) throw e
    }
  }

  return classicUpload(file, kind, folder)
}
