// Per-item "source" map for Furn, stored as a JSON object in S3.
//
// Keeps the AI's audit source OUT of the editable `details` field (so staff
// can't accidentally edit/delete it) and out of the customer PDF. Keyed by
// project → itemId, replaced wholesale on each re-process. Shown read-only on
// the pricing screen.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/furn-item-sources.json'

type Store = Record<string, Record<string, string>> // projectId → { itemId → source }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemSources(projectId: string): Promise<Record<string, string>> {
  return (await read())[projectId] || {}
}

export async function setProjectItemSources(projectId: string, map: Record<string, string>): Promise<void> {
  const store = await read()
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}
