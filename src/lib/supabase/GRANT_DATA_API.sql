-- ════════════════════════════════════════════════════════════════════════════
-- KAASEB — Supabase Data API grants (full project)
-- ════════════════════════════════════════════════════════════════════════════
-- Run this once in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Background:
--   On 2026-05-30 Supabase changed the default so new tables in `public` are
--   NOT exposed to the Data API (PostgREST / GraphQL / supabase-js) without
--   an explicit GRANT. Enforcement on existing projects starts 2026-10-30.
--
-- What this script does:
--   1. Grants USAGE on the `public` schema to the three Data API roles
--      (anon, authenticated, service_role).
--   2. Grants full table / sequence / function privileges on EVERYTHING
--      that currently exists in `public`.
--   3. Sets ALTER DEFAULT PRIVILEGES so any FUTURE table / sequence /
--      function created in `public` is automatically exposed too — so we
--      never get bitten by this again.
--   4. Reloads the PostgREST schema cache so the dashboard sees the change
--      immediately.
--
-- Security note:
--   RLS still applies. These grants only expose the tables to the API; row
--   access is still controlled by your existing RLS policies. Any table
--   that should stay private must keep RLS ENABLED with the right policies
--   (which is already the case for all our tables — see SCHEMA.sql).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Schema usage ────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ─── 2. Existing objects ────────────────────────────────────────────────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated, service_role;

-- ─── 3. Future objects (default privileges) ─────────────────────────────────
-- Applies to anything created by `postgres` (the role migrations run as).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES  TO anon, authenticated, service_role;

-- Same again, but scoped to the `postgres` role explicitly — covers the
-- case where Supabase tooling creates objects under that exact owner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES  TO anon, authenticated, service_role;

-- ─── 4. Reload PostgREST schema cache ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- After running:
--   • Open Supabase Dashboard → Advisors → Security Advisor
--     and confirm there are no "Table not exposed to Data API" warnings.
--   • Hard-refresh the dashboard (Cmd-Shift-R) so the table list updates.
-- ════════════════════════════════════════════════════════════════════════════
