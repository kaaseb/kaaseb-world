-- Switches both furn_quotations and tannoor_quotations from a globally
-- unique `quotation_number` to a (project_id, quotation_number, language)
-- triple. After the change, the AR and EN PDFs of the same offer share
-- one number, and re-issuing the same quotation updates the existing
-- rows instead of allocating a new pair.
--
-- Order matters: we drop the OLD single-column UNIQUE first so the
-- collapse-update can rewrite EN rows to share their AR sibling's
-- number without tripping the constraint. We then add the new composite
-- UNIQUE.
--
-- Safe to run multiple times — every step uses IF EXISTS / IF NOT EXISTS
-- guards, the collapse only touches rows that still have the legacy
-- AR=N / EN=N+1 layout.

BEGIN;

-- ── Furn ──────────────────────────────────────────────────────────────────

-- 1. Drop the legacy UNIQUE. The auto-generated constraint name from
--    `UNIQUE` on a column is `<table>_<column>_key` in Postgres.
ALTER TABLE public.furn_quotations
  DROP CONSTRAINT IF EXISTS furn_quotations_quotation_number_key;
-- Also drop any prior composite key so the migration is fully re-runnable.
ALTER TABLE public.furn_quotations
  DROP CONSTRAINT IF EXISTS furn_quotations_project_quotation_lang_key;

-- 2. Collapse adjacent AR/EN pairs (AR=N, EN=N+1) onto a single number (N).
WITH paired AS (
  SELECT
    ar.id     AS ar_id,
    en.id     AS en_id,
    ar.quotation_number AS shared_number
  FROM public.furn_quotations ar
  JOIN public.furn_quotations en
    ON en.project_id = ar.project_id
   AND en.quotation_number = ar.quotation_number + 1
   AND ar.language = 'ar' AND en.language = 'en'
)
UPDATE public.furn_quotations f
   SET quotation_number = paired.shared_number
  FROM paired
 WHERE f.id = paired.en_id;

-- 3. Add the new composite UNIQUE.
ALTER TABLE public.furn_quotations
  ADD  CONSTRAINT furn_quotations_project_quotation_lang_key
       UNIQUE (project_id, quotation_number, language);

-- ── Tannoor ───────────────────────────────────────────────────────────────

ALTER TABLE public.tannoor_quotations
  DROP CONSTRAINT IF EXISTS tannoor_quotations_quotation_number_key;
ALTER TABLE public.tannoor_quotations
  DROP CONSTRAINT IF EXISTS tannoor_quotations_project_quotation_lang_key;

WITH paired AS (
  SELECT
    ar.id     AS ar_id,
    en.id     AS en_id,
    ar.quotation_number AS shared_number
  FROM public.tannoor_quotations ar
  JOIN public.tannoor_quotations en
    ON en.project_id = ar.project_id
   AND en.quotation_number = ar.quotation_number + 1
   AND ar.language = 'ar' AND en.language = 'en'
)
UPDATE public.tannoor_quotations t
   SET quotation_number = paired.shared_number
  FROM paired
 WHERE t.id = paired.en_id;

ALTER TABLE public.tannoor_quotations
  ADD  CONSTRAINT tannoor_quotations_project_quotation_lang_key
       UNIQUE (project_id, quotation_number, language);

COMMIT;

NOTIFY pgrst, 'reload schema';
