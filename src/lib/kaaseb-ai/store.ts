// Saved Kaaseb AI conversations — S3 only (no migrations), one folder per user.
//
//   app-data/kaaseb-ai/<userId>/index.json   → the user's conversation list
//   app-data/kaaseb-ai/<userId>/<convId>.json → that conversation's messages
//
// The user id comes from the session, never from the request, and both ids are
// validated before they touch a key — one person can never read or overwrite
// another person's chats.

import { randomBytes } from 'node:crypto'
import { readJson, mutateJson, writeJson, deleteFromS3 } from '@/lib/s3'
import type { AiCard } from './cards'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  cards?: AiCard[]
  at: string
  /** The reply failed — shown in red, not sent back to the model. */
  error?: boolean
}

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface ConversationFile {
  id: string
  messages: AiMessage[]
}

const MAX_CONVERSATIONS = 100
const MAX_MESSAGES = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONV = /^[0-9a-f]{20}$/

function base(userId: string): string {
  if (!UUID.test(userId)) throw new Error('bad user')
  return `app-data/kaaseb-ai/${userId.toLowerCase()}`
}
const indexKey = (userId: string) => `${base(userId)}/index.json`
function convKey(userId: string, convId: string): string {
  if (!CONV.test(convId)) throw new Error('bad conversation')
  return `${base(userId)}/${convId}.json`
}

export const isConversationId = (v: unknown): v is string => typeof v === 'string' && CONV.test(v)
export const newId = (bytes = 10) => randomBytes(bytes).toString('hex')

export async function listConversations(userId: string): Promise<ConversationMeta[]> {
  const list = await readJson<ConversationMeta[]>(indexKey(userId), [])
  return Array.isArray(list) ? list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : []
}

export async function getConversation(userId: string, convId: string): Promise<AiMessage[] | null> {
  const list = await listConversations(userId)
  if (!list.some((c) => c.id === convId)) return null
  const file = await readJson<ConversationFile | null>(convKey(userId, convId), null)
  return file?.messages ?? []
}

export async function createConversation(userId: string, firstMessage: string): Promise<ConversationMeta> {
  const now = new Date().toISOString()
  const t = firstMessage.replace(/\s+/g, ' ').trim()
  const meta: ConversationMeta = { id: newId(), title: t.length > 60 ? `${t.slice(0, 60)}…` : t || 'محادثة', createdAt: now, updatedAt: now }
  let dropped: ConversationMeta[] = []
  await mutateJson<ConversationMeta[]>(indexKey(userId), [], (cur) => {
    const all = [meta, ...(Array.isArray(cur) ? cur : [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    dropped = all.slice(MAX_CONVERSATIONS)
    return all.slice(0, MAX_CONVERSATIONS)
  })
  await writeJson(convKey(userId, meta.id), { id: meta.id, messages: [] } satisfies ConversationFile)
  for (const d of dropped) await deleteFromS3(convKey(userId, d.id)).catch(() => {})
  return meta
}

/** Mark a confirm card (by its action id) with its final status, so reopening
 *  the conversation shows «تم» / «أُلغي» instead of live buttons. */
export async function setConfirmStatus(userId: string, convId: string, actionId: string, status: 'done' | 'cancelled' | 'failed', note?: string): Promise<void> {
  if (!isConversationId(convId)) return
  await mutateJson<ConversationFile>(convKey(userId, convId), { id: convId, messages: [] }, (cur) => ({
    id: convId,
    messages: (cur?.messages || []).map((m) => (!m.cards?.some((c) => c.type === 'confirm' && c.actionId === actionId) ? m : {
      ...m,
      cards: m.cards.map((c) => (c.type === 'confirm' && c.actionId === actionId ? { ...c, status, ...(note ? { note } : {}) } : c)),
    })),
  }))
}

export async function appendMessages(userId: string, convId: string, msgs: AiMessage[]): Promise<void> {
  await mutateJson<ConversationFile>(convKey(userId, convId), { id: convId, messages: [] }, (cur) => ({
    id: convId,
    messages: [...(cur?.messages || []), ...msgs].slice(-MAX_MESSAGES),
  }))
  const now = new Date().toISOString()
  await mutateJson<ConversationMeta[]>(indexKey(userId), [], (cur) =>
    (Array.isArray(cur) ? cur : []).map((c) => (c.id === convId ? { ...c, updatedAt: now } : c)),
  )
}

export async function deleteConversation(userId: string, convId: string): Promise<boolean> {
  let found = false
  await mutateJson<ConversationMeta[]>(indexKey(userId), [], (cur) => {
    const list = Array.isArray(cur) ? cur : []
    found = list.some((c) => c.id === convId)
    return list.filter((c) => c.id !== convId)
  })
  if (found) await deleteFromS3(convKey(userId, convId)).catch(() => {})
  return found
}
