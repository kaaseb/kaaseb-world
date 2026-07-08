-- Adds bilingual columns for the four Furn-project terms fields. The
-- existing single-language columns stay in place so older quotations
-- keep printing — the renderer prefers the matching-language column and
-- falls back to the legacy column, then to the settings defaults.
--
-- Safe to run multiple times.

BEGIN;

ALTER TABLE public.furn_projects
  ADD COLUMN IF NOT EXISTS payment_terms_en      TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_ar      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms_en     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_terms_ar     TEXT,
  ADD COLUMN IF NOT EXISTS offer_duration_en     TEXT,
  ADD COLUMN IF NOT EXISTS offer_duration_ar     TEXT,
  ADD COLUMN IF NOT EXISTS special_conditions_en TEXT,
  ADD COLUMN IF NOT EXISTS special_conditions_ar TEXT;

COMMIT;

NOTIFY pgrst, 'reload schema';
