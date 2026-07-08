-- Adds engineer_phone, other_files, and source_client_project_id to the
-- existing furn_projects table. Safe to run multiple times — every step
-- uses IF NOT EXISTS / IF EXISTS guards.

BEGIN;

ALTER TABLE public.furn_projects
  ADD COLUMN IF NOT EXISTS engineer_phone TEXT;

ALTER TABLE public.furn_projects
  ADD COLUMN IF NOT EXISTS other_files JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.furn_projects
  ADD COLUMN IF NOT EXISTS source_client_project_id UUID;

-- Re-create the FK only if it isn't already there. Wrapped in DO/EXCEPTION
-- so re-running the script after a previous successful run is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'furn_projects_source_client_project_id_fkey'
  ) THEN
    ALTER TABLE public.furn_projects
      ADD CONSTRAINT furn_projects_source_client_project_id_fkey
      FOREIGN KEY (source_client_project_id)
      REFERENCES public.client_projects(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
