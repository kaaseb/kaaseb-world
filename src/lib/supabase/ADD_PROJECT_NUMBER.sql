-- Adds a monotonic, never-reused, 6-digit-display project_number to:
--   • client_projects
--   • furn_projects
--   • tannoor_projects
--
-- Each table gets its own sequence so the IDs are independent (a client
-- project numbered 000042 is unrelated to a furn project 000042). Existing
-- rows are back-filled in created_at order so the oldest project becomes
-- 000001, the second oldest 000002, etc.
--
-- Safe to run multiple times: every step uses IF NOT EXISTS guards and the
-- back-fill only touches rows whose project_number is still NULL.

BEGIN;

-- ── 1. client_projects ─────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.client_projects_number_seq START 1;
ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS project_number BIGINT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM public.client_projects
  WHERE project_number IS NULL
)
UPDATE public.client_projects t
   SET project_number = numbered.rn
  FROM numbered
 WHERE t.id = numbered.id;

-- Advance the sequence past anything we just inserted so future
-- nextval() calls pick up where we left off.
SELECT setval(
  'public.client_projects_number_seq',
  GREATEST(COALESCE((SELECT MAX(project_number) FROM public.client_projects), 0), 1),
  true
);

ALTER TABLE public.client_projects
  ALTER COLUMN project_number SET DEFAULT nextval('public.client_projects_number_seq'),
  ALTER COLUMN project_number SET NOT NULL;

ALTER TABLE public.client_projects
  DROP CONSTRAINT IF EXISTS client_projects_project_number_unique;
ALTER TABLE public.client_projects
  ADD CONSTRAINT client_projects_project_number_unique UNIQUE (project_number);

-- ── 2. furn_projects ───────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.furn_projects_number_seq START 1;
ALTER TABLE public.furn_projects
  ADD COLUMN IF NOT EXISTS project_number BIGINT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM public.furn_projects
  WHERE project_number IS NULL
)
UPDATE public.furn_projects t
   SET project_number = numbered.rn
  FROM numbered
 WHERE t.id = numbered.id;

SELECT setval(
  'public.furn_projects_number_seq',
  GREATEST(COALESCE((SELECT MAX(project_number) FROM public.furn_projects), 0), 1),
  true
);

ALTER TABLE public.furn_projects
  ALTER COLUMN project_number SET DEFAULT nextval('public.furn_projects_number_seq'),
  ALTER COLUMN project_number SET NOT NULL;

ALTER TABLE public.furn_projects
  DROP CONSTRAINT IF EXISTS furn_projects_project_number_unique;
ALTER TABLE public.furn_projects
  ADD CONSTRAINT furn_projects_project_number_unique UNIQUE (project_number);

-- ── 3. tannoor_projects ───────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.tannoor_projects_number_seq START 1;
ALTER TABLE public.tannoor_projects
  ADD COLUMN IF NOT EXISTS project_number BIGINT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
  FROM public.tannoor_projects
  WHERE project_number IS NULL
)
UPDATE public.tannoor_projects t
   SET project_number = numbered.rn
  FROM numbered
 WHERE t.id = numbered.id;

SELECT setval(
  'public.tannoor_projects_number_seq',
  GREATEST(COALESCE((SELECT MAX(project_number) FROM public.tannoor_projects), 0), 1),
  true
);

ALTER TABLE public.tannoor_projects
  ALTER COLUMN project_number SET DEFAULT nextval('public.tannoor_projects_number_seq'),
  ALTER COLUMN project_number SET NOT NULL;

ALTER TABLE public.tannoor_projects
  DROP CONSTRAINT IF EXISTS tannoor_projects_project_number_unique;
ALTER TABLE public.tannoor_projects
  ADD CONSTRAINT tannoor_projects_project_number_unique UNIQUE (project_number);

COMMIT;

NOTIFY pgrst, 'reload schema';
