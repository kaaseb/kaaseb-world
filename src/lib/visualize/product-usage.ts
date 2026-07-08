// Tracks how often each catalogue product is used in "النفق السحري", so the
// product picker can default to the few most-used products (and surface the
// long tail only through search). S3-backed; no DB columns needed.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/visualize-product-usage.json'
type Usage = Record<string, number>

export async function getUsage(): Promise<Usage> {
  const u = await readJson<Usage>(KEY, {})
  return u && typeof u === 'object' ? u : {}
}

export async function bumpUsage(productId: string): Promise<void> {
  if (!productId) return
  const u = await getUsage()
  u[productId] = (u[productId] || 0) + 1
  await writeJson(KEY, u)
}

// Product ids ordered by descending use count (most-used first).
export async function topProductIds(n: number): Promise<string[]> {
  const u = await getUsage()
  return Object.entries(u)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, n))
    .map(([id]) => id)
}
