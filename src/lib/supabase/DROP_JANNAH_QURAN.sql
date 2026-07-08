-- Drop Jannah (الجنة) and Quran (القرآن) tables from an existing database.
-- Safe to run on a DB that was previously created from SCHEMA.sql before these
-- features were removed. Idempotent — every DROP uses IF EXISTS.
--
-- Run this once in the Supabase SQL editor against the project that holds the
-- old tables. Nothing else is touched.

BEGIN;

-- Jannah (12 tables). jannah_counter_logs references jannah_inventory, so
-- drop it first to be explicit; CASCADE handles it either way.
DROP TABLE IF EXISTS public.jannah_counter_logs         CASCADE;
DROP TABLE IF EXISTS public.jannah_inventory            CASCADE;
DROP TABLE IF EXISTS public.jannah_inventory_categories CASCADE;
DROP TABLE IF EXISTS public.jannah_tasks                CASCADE;
DROP TABLE IF EXISTS public.jannah_task_types           CASCADE;
DROP TABLE IF EXISTS public.jannah_quran_sessions       CASCADE;
DROP TABLE IF EXISTS public.jannah_duas                 CASCADE;
DROP TABLE IF EXISTS public.jannah_timing_types         CASCADE;
DROP TABLE IF EXISTS public.jannah_charity              CASCADE;
DROP TABLE IF EXISTS public.jannah_frequency_types      CASCADE;
DROP TABLE IF EXISTS public.jannah_charity_types        CASCADE;
DROP TABLE IF EXISTS public.jannah_goals                CASCADE;

-- Quran (4 tables).
DROP TABLE IF EXISTS public.quran_notes          CASCADE;
DROP TABLE IF EXISTS public.quran_streaks        CASCADE;
DROP TABLE IF EXISTS public.quran_goals          CASCADE;
DROP TABLE IF EXISTS public.quran_surah_progress CASCADE;

COMMIT;

-- Refresh PostgREST schema cache so the new state is visible to the API.
NOTIFY pgrst, 'reload schema';
