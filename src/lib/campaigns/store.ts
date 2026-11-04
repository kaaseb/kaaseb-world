// What the campaign has done — S3 only (app-data/campaigns/<id>.json).
// `sent` is the guarantee that a company never gets the same email twice.

import { readJson, mutateJson } from '@/lib/s3'
import { CAMPAIGN_ID } from './stone-2026'

export interface SentRecord { at: string; by: string; to: string[]; attached: boolean }
export interface FailRecord { at: string; error: string }

export interface CampaignState {
  subject: string | null
  body: string | null
  sent: Record<string, SentRecord>
  failed: Record<string, FailRecord>
}

const KEY = `app-data/campaigns/${CAMPAIGN_ID}.json`
const EMPTY: CampaignState = { subject: null, body: null, sent: {}, failed: {} }

export async function getCampaignState(): Promise<CampaignState> {
  const s = await readJson<Partial<CampaignState>>(KEY, {})
  return { ...EMPTY, ...s, sent: s.sent || {}, failed: s.failed || {} }
}

export async function saveCampaignText(subject: string | null, body: string | null): Promise<void> {
  await mutateJson<CampaignState>(KEY, EMPTY, (cur) => ({ ...EMPTY, ...cur, subject, body }))
}

/** Reserve a company before sending. False = already sent (or being sent). */
export async function claimTarget(id: string, by: string): Promise<boolean> {
  let won = false
  await mutateJson<CampaignState>(KEY, EMPTY, (cur) => {
    const s = { ...EMPTY, ...cur, sent: { ...(cur?.sent || {}) }, failed: { ...(cur?.failed || {}) } }
    if (s.sent[id]) { won = false; return s }
    won = true
    s.sent[id] = { at: new Date().toISOString(), by, to: [], attached: false }
    delete s.failed[id]
    return s
  })
  return won
}

export async function finishTarget(id: string, rec: SentRecord): Promise<void> {
  await mutateJson<CampaignState>(KEY, EMPTY, (cur) => ({ ...EMPTY, ...cur, sent: { ...(cur?.sent || {}), [id]: rec } }))
}

/** The send failed: release the claim and remember why (it can be retried). */
export async function failTarget(id: string, error: string): Promise<void> {
  await mutateJson<CampaignState>(KEY, EMPTY, (cur) => {
    const sent = { ...(cur?.sent || {}) }
    delete sent[id]
    return { ...EMPTY, ...cur, sent, failed: { ...(cur?.failed || {}), [id]: { at: new Date().toISOString(), error: error.slice(0, 300) } } }
  })
}
