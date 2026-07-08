// Product image map { productId → S3 url }, stored as a JSON object in S3
// (durable + serverless-safe). The image binaries live in S3 too (uploaded via
// /api/upload, kind=tannoor_products); here we only persist the association.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/tannoor-product-images.json'

export type ProductImageMap = Record<string, string>

export async function getProductImages(): Promise<ProductImageMap> {
  return readJson<ProductImageMap>(KEY, {})
}

export async function setProductImage(productId: string, url: string | null): Promise<ProductImageMap> {
  const map = await getProductImages()
  if (url) map[productId] = url
  else delete map[productId]
  await writeJson(KEY, map)
  return map
}
