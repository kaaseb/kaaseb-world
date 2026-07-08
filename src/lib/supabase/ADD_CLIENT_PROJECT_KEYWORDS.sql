-- Adds the `keywords` column to client_projects (single free-text bag,
-- not bilingual) and flips the default stage to receive_quotes
-- (استلام العروض السعرية). Safe to run multiple times.

BEGIN;

ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS keywords TEXT;

-- Future inserts default to "receive_quotes". Existing rows are not
-- migrated — their stage is whatever it already was.
ALTER TABLE public.client_projects
  ALTER COLUMN stage SET DEFAULT 'receive_quotes';

COMMIT;

NOTIFY pgrst, 'reload schema';
