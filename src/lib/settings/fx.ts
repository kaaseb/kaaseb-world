// USD ↔ SAR exchange rate — a single company-wide setting.
//
// WHY THIS EXISTS: today each Tannoor product carries TWO independent
// hand-typed prices (`price_sar`, `price_usd`), and the USD one drifts or gets
// left at 0 — which is how a USD quote once went out at SAR numbers. The owner
// wants one rate instead: pick 3.75 / 3.80 / custom, and USD is derived from
// the SAR price. `manual` keeps the old per-product behaviour so nothing breaks
// for anyone already relying on it.
//
// STORAGE: S3, not a DB column. The owner has no migration access — adding a
// column is a hard "no" in this project. Same `app-data/*.json` pattern as every
// other tableless setting here.

import { readJson, writeJson } from '@/lib/s3'

const KEY = 'app-data/fx.json'

// 'manual'  → use each product's own price_usd (legacy behaviour, the default)
// 'rate_375'→ USD = SAR / 3.75   (SAR is officially pegged at 3.75/USD)
// 'rate_380'→ USD = SAR / 3.80
// 'custom'  → USD = SAR / customRate
export type FxMode = 'manual' | 'rate_375' | 'rate_380' | 'custom'

export interface FxSettings {
  mode: FxMode
  customRate: number
  updatedAt: string
  updatedBy: string | null
}

// Default is 'manual' ON PURPOSE — flipping the default would silently re-price
// every existing product the first time this ships.
const DEFAULT_FX: FxSettings = {
  mode: 'manual',
  customRate: 3.75,
  updatedAt: '',
  updatedBy: null,
}

// Guard against a hand-broken blob or an absurd custom value.
function sanitizeRate(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return 3.75
  // A SAR/USD rate outside this band is a typo (3.75 is the peg). Clamp rather
  // than let "375" quietly divide every price by 375.
  return Math.min(20, Math.max(0.1, n))
}

export async function getFxSettings(): Promise<FxSettings> {
  const s = await readJson<Partial<FxSettings> | null>(KEY, null)
  if (!s) return { ...DEFAULT_FX }
  const mode: FxMode =
    s.mode === 'rate_375' || s.mode === 'rate_380' || s.mode === 'custom' || s.mode === 'manual'
      ? s.mode
      : 'manual'
  return {
    mode,
    customRate: sanitizeRate(s.customRate),
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
    updatedBy: typeof s.updatedBy === 'string' ? s.updatedBy : null,
  }
}

export async function setFxSettings(patch: {
  mode?: FxMode
  customRate?: number
  updatedBy?: string | null
}): Promise<FxSettings> {
  const current = await getFxSettings()
  const next: FxSettings = {
    mode: patch.mode ?? current.mode,
    customRate: patch.customRate !== undefined ? sanitizeRate(patch.customRate) : current.customRate,
    updatedAt: new Date().toISOString(),
    updatedBy: patch.updatedBy ?? current.updatedBy,
  }
  await writeJson(KEY, next)
  return next
}

// The effective SAR-per-USD rate, or null in 'manual' mode (meaning: don't
// convert, honour the product's own price_usd).
export function resolveRate(fx: FxSettings): number | null {
  switch (fx.mode) {
    case 'rate_375': return 3.75
    case 'rate_380': return 3.80
    case 'custom': return sanitizeRate(fx.customRate)
    case 'manual': return null
  }
}

/** Round money to 2 dp at a single chokepoint, so line sums reconcile with the
 *  stored NUMERIC(16,2) totals instead of drifting by a cent. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/**
 * The USD unit price to use for a product.
 *
 * `manual` mode → the product's own price_usd (unchanged legacy behaviour).
 * a rate mode  → derived from price_sar at the configured rate, IGNORING the
 *                stored price_usd, because the whole point is to stop maintaining
 *                a second column that drifts.
 *
 * Returns null only when there's genuinely nothing to price from.
 */
export function usdPrice(
  fx: FxSettings,
  priceSar: number | null | undefined,
  priceUsd: number | null | undefined,
): number | null {
  const rate = resolveRate(fx)
  if (rate === null) {
    return priceUsd == null ? null : Number(priceUsd)
  }
  if (priceSar == null) return priceUsd == null ? null : Number(priceUsd)
  return round2(Number(priceSar) / rate)
}
