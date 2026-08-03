// The full sanitized HTML body of a hydrated email — kept in its OWN small S3
// object, NOT in the main inbox.json blob.
//
// Why: inbox.json is read on every list poll (every 5s) and rewritten on every
// mark-read / reply / archive. An HTML body can be hundreds of KB, so folding it
// into that hot blob would make each poll and each tiny status change transfer
// megabytes. Here each body is a cold object fetched only when the reader opens
// one message — so the hot path stays tiny.

import { createHash } from 'crypto'
import { readJson, writeJson } from '@/lib/s3'

function keyFor(id: string): string {
  const h = createHash('sha1').update(id).digest('hex').slice(0, 20)
  return `app-data/inbox-bodies/${h}.json`
}

export async function getEmailBody(id: string): Promise<string | null> {
  const o = await readJson<{ html: string }>(keyFor(id), { html: '' })
  return o?.html || null
}

export async function setEmailBody(id: string, html: string | null): Promise<void> {
  await writeJson(keyFor(id), { html: html || '' })
}
