// Per-item review FLAGS for Furn, stored in S3 (no DB columns — same constraint
// as item-sources). The router never drops a requested line now; instead the
// doubtful ones are flagged here and the team approves or rejects each.
//
//   • reason  — why it's flagged (unclear material / look-alike / out of scope /
//               duplicate), Arabic, shown on the row.
//   • red     — true for a likely upload mistake / not-our-department line, so
//               the row shows RED ("go back and check with the customer").
//   • status  — 'pending' until a human acts; 'approved' keeps it in the quote,
//               'rejected' excludes it from the quotation (but never deletes it).
//
// Keyed project → itemId, rewritten wholesale on each re-process (same lifecycle
// as sources — item ids change every run). `status` is the ONE field the team
// mutates afterwards, via updateItemFlagStatus.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/furn-item-flags.json'

export type FlagStatus = 'pending' | 'approved' | 'rejected'

export interface ItemFlag {
  reason: string
  red: boolean
  status: FlagStatus
}

type Store = Record<string, Record<string, ItemFlag>> // projectId → { itemId → flag }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemFlags(projectId: string): Promise<Record<string, ItemFlag>> {
  return (await read())[projectId] || {}
}

export async function setProjectItemFlags(projectId: string, map: Record<string, ItemFlag>): Promise<void> {
  const store = await read()
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}

/** Team action: approve/reject a single flagged item. Returns the new flag or
 *  null if the item wasn't flagged. */
export async function updateItemFlagStatus(
  projectId: string,
  itemId: string,
  status: FlagStatus,
): Promise<ItemFlag | null> {
  const store = await read()
  const map = store[projectId]
  if (!map || !map[itemId]) return null
  map[itemId] = { ...map[itemId], status }
  await writeJson(KEY, store)
  return map[itemId]
}
