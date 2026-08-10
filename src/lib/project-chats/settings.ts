// The project-chat feature toggle. Enabled by default (owner's request); the
// super-admin can turn it off from Settings, which hides the floating launcher
// and the project chat tab everywhere.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/project-chat-settings.json'

export async function getProjectChatEnabled(): Promise<boolean> {
  const s = await readJson<{ enabled?: boolean }>(KEY, {})
  // Default ON: only an explicit `false` disables it.
  return s?.enabled !== false
}

export async function setProjectChatEnabled(enabled: boolean): Promise<void> {
  await writeJson(KEY, { enabled: !!enabled })
}
