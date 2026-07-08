// Per-item "source" map for Tannoor, stored as a JSON object in S3 (durable +
// serverless-safe). tannoor_items has no source column, so we keep the AI's
// audit source (where each quantity came from) keyed by project → itemId.
// Replaced wholesale each time a project is re-processed, so it never goes
// stale. Read by the project screen to show a "📄 source" line per item.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/tannoor-item-sources.json'

type Store = Record<string, Record<string, string>> // projectId → { itemId → source }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemSources(projectId: string): Promise<Record<string, string>> {
  return (await read())[projectId] || {}
}

// Replace the whole project's map (called right after a re-process).
export async function setProjectItemSources(projectId: string, map: Record<string, string>): Promise<void> {
  const store = await read()
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}
