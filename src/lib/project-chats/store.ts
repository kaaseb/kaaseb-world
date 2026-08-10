// Maps each client project to its chat conversation (reusing the existing
// chat_conversations/chat_messages tables). The link lives in S3 — no new DB
// column — keyed projectId → conversationId.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/project-chats.json'

type Map_ = Record<string, string> // projectId → conversationId

export async function getProjectConversationId(projectId: string): Promise<string | null> {
  const m = await readJson<Map_>(KEY, {})
  return m[projectId] || null
}

export async function setProjectConversationId(projectId: string, conversationId: string): Promise<void> {
  const m = await readJson<Map_>(KEY, {})
  m[projectId] = conversationId
  await writeJson(KEY, m)
}
