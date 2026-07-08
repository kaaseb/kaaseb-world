-- ════════════════════════════════════════════════════════════════════════════
-- KAASEB — responsible_user_id on client_projects + details on furn_items
-- ════════════════════════════════════════════════════════════════════════════
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- What it does:
--   1. Adds `responsible_user_id` to `client_projects` (the person owning
--      the project on our side). FK → public.profiles, nullable, on delete
--      set null so removing a profile doesn't break old projects.
--
--   2. Adds `details` to `furn_items` — the LONG descriptive text the AI
--      used to put into `notes`. The pricing table and the quotation PDF
--      now show item description as a title with `details` underneath in
--      a smaller font, and the `notes` column is reclaimed as a clean,
--      user-editable field (the team adds their own notes there).
--
--   3. Migrates existing data: copies `furn_items.notes` → `furn_items.details`
--      for every row where details is still NULL, then clears `notes`
--      so the column is empty for the team to fill in.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. client_projects.responsible_user_id ────────────────────────────────
ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS responsible_user_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_projects_responsible
  ON public.client_projects(responsible_user_id);

-- ─── 2. furn_items.details ─────────────────────────────────────────────────
ALTER TABLE public.furn_items
  ADD COLUMN IF NOT EXISTS details TEXT;

-- ─── 3. Backfill: notes → details, then clear notes ────────────────────────
-- Only touch rows whose details is still NULL so re-running doesn't undo
-- any team edits made after the first migration.
UPDATE public.furn_items
   SET details = notes
 WHERE details IS NULL
   AND notes IS NOT NULL
   AND length(trim(notes)) > 0;

UPDATE public.furn_items
   SET notes = NULL
 WHERE notes IS NOT NULL
   AND details IS NOT NULL
   AND notes = details;

-- ─── 4. Reload PostgREST schema cache ──────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
