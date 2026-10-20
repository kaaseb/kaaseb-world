// Changes Kaaseb AI PROPOSED and that wait for the user's own «تأكيد».
//
// SECURITY: the model can only create a proposal. Executing it takes a click
// by the signed-in user on the confirm card, which posts to
// /api/kaaseb-ai/actions/[id] — permission is re-checked there, the action
// must belong to that user, still be pending and fresh, and the record must not
// have changed since the proposal was made. A prompt-injected email can at
// worst put a proposal on screen; it can never apply one.
//
//   app-data/kaaseb-ai/<userId>/actions/<actionId>.json

import { randomBytes } from 'node:crypto'
import { readJson, writeJson, mutateJson } from '@/lib/s3'
import type { ManualQuote } from '@/lib/manual-quotes/store'

export type ActionStatus = 'pending' | 'done' | 'cancelled' | 'failed'

export interface PendingAction {
  id: string
  kind: 'quote_edit' | 'quote_restore'
  status: ActionStatus
  userId: string
  conversationId: string
  quoteId: string
  quoteNumber: number
  /** The quote's updatedAt when proposed — a later edit invalidates the proposal. */
  baseUpdatedAt: string
  patch?: Partial<ManualQuote>
  entryId?: string
  createdAt: string
}

export const ACTION_TTL_MS = 30 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AID = /^[0-9a-f]{20}$/

export const isActionId = (v: unknown): v is string => typeof v === 'string' && AID.test(v)

function key(userId: string, id: string): string {
  if (!UUID.test(userId) || !AID.test(id)) throw new Error('bad action key')
  return `app-data/kaaseb-ai/${userId.toLowerCase()}/actions/${id}.json`
}

export async function createAction(a: Omit<PendingAction, 'id' | 'status' | 'createdAt'>): Promise<PendingAction> {
  const action: PendingAction = { ...a, id: randomBytes(10).toString('hex'), status: 'pending', createdAt: new Date().toISOString() }
  await writeJson(key(a.userId, action.id), action)
  return action
}

export async function getAction(userId: string, id: string): Promise<PendingAction | null> {
  return readJson<PendingAction | null>(key(userId, id), null)
}

/** Atomically move a PENDING action to its final status. False if it was not
 *  pending any more (double click, second tab). */
export async function settleAction(userId: string, id: string, status: Exclude<ActionStatus, 'pending'>): Promise<boolean> {
  let won = false
  await mutateJson<PendingAction | null>(key(userId, id), null, (cur) => {
    if (!cur || cur.status !== 'pending') { won = false; return cur }
    won = true
    return { ...cur, status }
  })
  return won
}
