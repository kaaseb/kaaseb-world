// "قالب التواصل" — the outreach email the team sends to an opportunity or a
// target company, plus the company-profile PDF attached to every send.
//
// Stored in S3 (no DB columns — same rule as every other setting here). The body
// is PLAIN TEXT with {{placeholders}} so the sender can edit it per send without
// touching HTML, and an unfilled placeholder always degrades to a neutral phrase
// instead of shipping a literal "{{company}}" to a customer.

import { readJson, writeJson } from '@/lib/s3'
import { DEFAULT_SUBJECT, DEFAULT_BODY } from './render'

export { DEFAULT_SUBJECT, DEFAULT_BODY, renderOutreach } from './render'

const KEY = 'app-data/outreach.json'

export interface OutreachTemplate {
  subject: string
  body: string
  /** The company profile attached to every outreach mail (uploaded once). */
  profileUrl: string | null
  profileName: string | null
  updatedAt: string | null
}

export async function getOutreachTemplate(): Promise<OutreachTemplate> {
  const s = await readJson<Partial<OutreachTemplate> | null>(KEY, null)
  return {
    subject: (s?.subject || DEFAULT_SUBJECT).slice(0, 300),
    body: s?.body || DEFAULT_BODY,
    profileUrl: s?.profileUrl || null,
    profileName: s?.profileName || null,
    updatedAt: s?.updatedAt || null,
  }
}

export async function saveOutreachTemplate(
  patch: Partial<OutreachTemplate>,
): Promise<OutreachTemplate> {
  const cur = await getOutreachTemplate()
  const next: OutreachTemplate = {
    subject: (patch.subject ?? cur.subject).trim().slice(0, 300) || DEFAULT_SUBJECT,
    body: (patch.body ?? cur.body).slice(0, 20000) || DEFAULT_BODY,
    profileUrl: patch.profileUrl !== undefined ? patch.profileUrl : cur.profileUrl,
    profileName: patch.profileName !== undefined ? patch.profileName : cur.profileName,
    updatedAt: new Date().toISOString(),
  }
  await writeJson(KEY, next)
  return next
}
