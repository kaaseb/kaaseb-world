// Per-item SECTION heading for Furn (the BOQ sheet/tab an item came from).
// S3, no DB column — same pattern as item-sources/item-flags. Shown as a group
// header on the PRICING screen only; the customer quotation lists items flat.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/furn-item-sections.json'

type Store = Record<string, Record<string, string>> // projectId → { itemId → section }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemSections(projectId: string): Promise<Record<string, string>> {
  return (await read())[projectId] || {}
}

export async function setProjectItemSections(projectId: string, map: Record<string, string>): Promise<void> {
  const store = await read()
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}
