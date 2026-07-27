// Per-item OPTIONAL image map for Tannoor quotations, stored as JSON in S3
// (durable + serverless-safe). tannoor_items has no image column, so the team's
// per-line photo (a stone sample / mockup) is kept here keyed project → itemId →
// S3 url. It renders as a small thumbnail on the quotation PDF. Optional: most
// lines carry none, and the image column only appears when at least one does.
//
// The binaries live in S3 too (uploaded via /api/upload, kind=tannoor_products);
// here we persist only the association. Unlike the sources map this is NOT wiped
// on re-process — a re-run keeps the same item ids, so images survive; a truly
// removed item just leaves a dangling entry, which the print page ignores.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/tannoor-item-images.json'

type Store = Record<string, Record<string, string>> // projectId → { itemId → url }

async function read(): Promise<Store> {
  return readJson<Store>(KEY, {})
}

export async function getProjectItemImages(projectId: string): Promise<Record<string, string>> {
  return (await read())[projectId] || {}
}

// Set or clear ONE item's image (url=null removes it).
export async function setProjectItemImage(projectId: string, itemId: string, url: string | null): Promise<void> {
  const store = await read()
  const map = store[projectId] || {}
  if (url) map[itemId] = url
  else delete map[itemId]
  if (Object.keys(map).length === 0) delete store[projectId]
  else store[projectId] = map
  await writeJson(KEY, store)
}
