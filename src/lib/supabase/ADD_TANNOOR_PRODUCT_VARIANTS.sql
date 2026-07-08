-- ════════════════════════════════════════════════════════════════════════════
-- KAASEB — extra product attributes on tannoor_products
-- ════════════════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Context:
--   A single marble/granite product can have many price points — different
--   colour, finish, thickness, slab size, and availability all change the
--   number. We treat each row in `tannoor_products` as a specific VARIANT
--   (effectively a SKU): the same base material name can appear multiple
--   times with different attribute combinations and each row carries its
--   own price.
--
-- What this script adds:
--   • size_w_mm  — slab/tile width in millimetres (W).
--   • size_l_mm  — slab/tile length in millimetres (L).
--   • availability — bilingual stock signal: high / medium / low / out_of_stock.
--     Stored as a TEXT enum (CHECK constraint). The UI surfaces it as a
--     coloured pill so the sales team can see at-a-glance what's deep in
--     stock vs. one-off.
--
-- The other "variant" columns (thickness_mm, color_en/ar, finish, unit,
-- price_sar, price_usd, notes) already exist — no schema change needed for
-- those.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tannoor_products
  ADD COLUMN IF NOT EXISTS size_w_mm  NUMERIC(10, 2)
    CHECK (size_w_mm IS NULL OR size_w_mm >= 0);

ALTER TABLE public.tannoor_products
  ADD COLUMN IF NOT EXISTS size_l_mm  NUMERIC(10, 2)
    CHECK (size_l_mm IS NULL OR size_l_mm >= 0);

ALTER TABLE public.tannoor_products
  ADD COLUMN IF NOT EXISTS availability TEXT
    CHECK (availability IS NULL OR availability IN ('high', 'medium', 'low', 'out_of_stock'));

NOTIFY pgrst, 'reload schema';

COMMIT;
