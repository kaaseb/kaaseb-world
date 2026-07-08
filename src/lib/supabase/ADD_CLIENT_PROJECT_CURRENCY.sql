-- Add the pricing currency column to an existing client_projects table.
-- Safe to run multiple times — uses IF NOT EXISTS / IF EXISTS guards.
--
-- Default is SAR (Saudi Riyal). USD is the only other currency the UI exposes
-- today; loosen the CHECK constraint if you need more.

BEGIN;

ALTER TABLE public.client_projects
  ADD COLUMN IF NOT EXISTS pricing_currency TEXT NOT NULL DEFAULT 'SAR';

-- Drop the constraint if it already exists from a prior run, then re-add it
-- so this script remains idempotent even if the allowed set changes later.
ALTER TABLE public.client_projects
  DROP CONSTRAINT IF EXISTS client_projects_pricing_currency_check;
ALTER TABLE public.client_projects
  ADD  CONSTRAINT client_projects_pricing_currency_check
       CHECK (pricing_currency IN ('SAR','USD'));

COMMIT;

NOTIFY pgrst, 'reload schema';
