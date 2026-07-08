-- Adds thickness, color (bilingual) and finish to tannoor_products so the
-- catalog can describe what the AI/team actually need to price: a slab of
-- 20 mm white marble polished is a different SKU from a 30 mm beige honed
-- slab. Safe to re-run.

BEGIN;

ALTER TABLE public.tannoor_products
  ADD COLUMN IF NOT EXISTS thickness_mm NUMERIC,
  ADD COLUMN IF NOT EXISTS color_en     TEXT,
  ADD COLUMN IF NOT EXISTS color_ar     TEXT,
  ADD COLUMN IF NOT EXISTS finish       TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';
