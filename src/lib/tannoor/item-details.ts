// Per-item "details" line for Tannoor (thickness – finish – size – colour…),
// kept in S3 because tannoor_items has no details column. Written by the
// process route after a run, read by the project screen and the print page so
// a Tannoor quotation carries the same descriptive sub-line a Furn one does.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/tannoor-item-details.json'

type Store = Record<string, Record<string, string>> // projectId → { itemId → details }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemDetails(projectId: string): Promise<Record<string, string>> {
  return (await read())[projectId] || {}
}

export async function setProjectItemDetails(projectId: string, map: Record<string, string>): Promise<void> {
  const store = await read()
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}
