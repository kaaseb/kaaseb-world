-- ════════════════════════════════════════════════════════════════════════════
-- KAASEB — one-shot fix
-- ════════════════════════════════════════════════════════════════════════════
-- Run this single file in Supabase SQL Editor. It is idempotent — safe to
-- re-run any time. What it does:
--
--   1. Creates every new table introduced by Projects, Tannoor (products,
--      pricing methods, projects, items, quotations), Important Documents
--      and Pre-qualifications, with their indexes, RLS policies, and
--      updated_at triggers. Skips tables that already exist.
--
--   2. Adds `seal_image_url` + `next_tannoor_number` to `furn_settings` if
--      they aren't there yet.
--
--   3. Promotes `elzubair.mail@gmail.com` (and `it@ghassl.com`) to
--      super_admin — creating the profile row if it's missing, updating
--      the role if it already exists.
--
--   4. Refreshes the PostgREST schema cache so the new tables are visible
--      to the dashboard immediately.
--
-- After running this, do BOTH of these in the dashboard:
--   • Sign out then sign back in (so the session picks up the new role)
--   • Hard-refresh the browser (Cmd-Shift-R / Ctrl-Shift-R)
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Client Projects ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en             TEXT,
  name_ar             TEXT,
  company_en          TEXT,
  company_ar          TEXT,
  engineer_name_en    TEXT,
  engineer_name_ar    TEXT,
  engineer_phone      TEXT,
  end_date            DATE,
  status              TEXT NOT NULL DEFAULT 'new',
  stage               TEXT NOT NULL DEFAULT 'plans_intake',
  notes               TEXT,
  files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_projects_status   ON public.client_projects(status);
CREATE INDEX IF NOT EXISTS idx_client_projects_stage    ON public.client_projects(stage);
CREATE INDEX IF NOT EXISTS idx_client_projects_end_date ON public.client_projects(end_date);
CREATE INDEX IF NOT EXISTS idx_client_projects_created  ON public.client_projects(created_at DESC);


-- ─── 2. Important Documents ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.important_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en      TEXT,
  name_ar      TEXT,
  file_url     TEXT NOT NULL,
  file_name    TEXT,
  file_key     TEXT,
  expiry_date  DATE,
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_important_docs_expiry ON public.important_documents(expiry_date);


-- ─── 3. Pre-qualifications ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pre_qualifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_en        TEXT,
  company_ar        TEXT,
  project_name_en   TEXT,
  project_name_ar   TEXT,
  document_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  stamp_mode        TEXT NOT NULL DEFAULT 'last' CHECK (stamp_mode IN ('last','all','none')),
  output_pdf_url    TEXT,
  output_pdf_key    TEXT,
  generated_at      TIMESTAMPTZ,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pre_qual_created ON public.pre_qualifications(created_at DESC);


-- ─── 4. Tannoor pricing methods ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tannoor_pricing_methods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en        TEXT,
  name_ar        TEXT,
  description_en TEXT,
  description_ar TEXT,
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── 5. Tannoor products ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tannoor_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en           TEXT,
  name_ar           TEXT,
  description_en    TEXT,
  description_ar    TEXT,
  department_id     UUID REFERENCES public.furn_departments(id) ON DELETE SET NULL,
  pricing_method_id UUID REFERENCES public.tannoor_pricing_methods(id) ON DELETE SET NULL,
  unit              TEXT NOT NULL DEFAULT 'm',
  price_sar         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_sar >= 0),
  price_usd         NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price_usd >= 0),
  notes             TEXT,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tannoor_products_dept   ON public.tannoor_products(department_id);
CREATE INDEX IF NOT EXISTS idx_tannoor_products_method ON public.tannoor_products(pricing_method_id);


-- ─── 6. Tannoor projects ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tannoor_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name_en          TEXT,
  project_name_ar          TEXT,
  company_en               TEXT,
  company_ar               TEXT,
  engineer_name_en         TEXT,
  engineer_name_ar         TEXT,
  engineer_phone           TEXT,
  commercial_register      TEXT,
  tax_number               TEXT,
  subject                  TEXT,
  payment_terms            TEXT,
  delivery_terms           TEXT,
  offer_duration           TEXT,
  special_conditions       TEXT,
  stage                    TEXT NOT NULL DEFAULT 'processing'
                                CHECK (stage IN ('processing','quoted')),
  status                   TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','in_progress','completed','rejected','archived','missing_products')),
  boq_url                  TEXT,
  boq_filename             TEXT,
  spec_files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  drawing_files            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary               TEXT,
  ai_detected_departments  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ai_missing_items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_error                 TEXT,
  created_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tannoor_projects_created ON public.tannoor_projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tannoor_projects_stage   ON public.tannoor_projects(stage);
CREATE INDEX IF NOT EXISTS idx_tannoor_projects_status  ON public.tannoor_projects(status);


-- ─── 7. Tannoor items ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tannoor_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 1,
  description   TEXT NOT NULL,
  quantity      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit          TEXT NOT NULL DEFAULT 'm',
  product_id    UUID REFERENCES public.tannoor_products(id) ON DELETE SET NULL,
  unit_price    NUMERIC(14,2),
  currency      TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','USD')),
  notes         TEXT,
  is_missing    BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence NUMERIC(4,3),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tannoor_items_project ON public.tannoor_items(project_id, position);


-- ─── 8. Tannoor quotations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tannoor_quotations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  quotation_number INT NOT NULL UNIQUE,
  language         TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  currency         TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','USD')),
  vat_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.15,
  subtotal         NUMERIC(16,2) NOT NULL DEFAULT 0,
  vat_amount       NUMERIC(16,2) NOT NULL DEFAULT 0,
  total            NUMERIC(16,2) NOT NULL DEFAULT 0,
  pdf_url          TEXT,
  generated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tannoor_quotations_project ON public.tannoor_quotations(project_id, generated_at DESC);


-- ─── 9. Extend furn_settings (seal + tannoor counter) ───────────────────────
ALTER TABLE public.furn_settings
  ADD COLUMN IF NOT EXISTS seal_image_url      TEXT,
  ADD COLUMN IF NOT EXISTS next_tannoor_number INT NOT NULL DEFAULT 5000;


-- ─── 10. RLS + permissive policies ──────────────────────────────────────────
ALTER TABLE public.client_projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.important_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_qualifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_pricing_methods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tannoor_quotations       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_projects_auth_all          ON public.client_projects;
DROP POLICY IF EXISTS important_documents_auth_all      ON public.important_documents;
DROP POLICY IF EXISTS pre_qualifications_auth_all       ON public.pre_qualifications;
DROP POLICY IF EXISTS tannoor_pricing_methods_auth_all  ON public.tannoor_pricing_methods;
DROP POLICY IF EXISTS tannoor_products_auth_all         ON public.tannoor_products;
DROP POLICY IF EXISTS tannoor_projects_auth_all         ON public.tannoor_projects;
DROP POLICY IF EXISTS tannoor_items_auth_all            ON public.tannoor_items;
DROP POLICY IF EXISTS tannoor_quotations_auth_all       ON public.tannoor_quotations;

CREATE POLICY client_projects_auth_all          ON public.client_projects          FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY important_documents_auth_all      ON public.important_documents      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY pre_qualifications_auth_all       ON public.pre_qualifications       FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_pricing_methods_auth_all  ON public.tannoor_pricing_methods  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_products_auth_all         ON public.tannoor_products         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_projects_auth_all         ON public.tannoor_projects         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_items_auth_all            ON public.tannoor_items            FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY tannoor_quotations_auth_all       ON public.tannoor_quotations       FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ─── 11. updated_at triggers (re-use the existing generic toucher) ─────────
DROP TRIGGER IF EXISTS touch_client_projects    ON public.client_projects;
DROP TRIGGER IF EXISTS touch_important_docs     ON public.important_documents;
DROP TRIGGER IF EXISTS touch_pre_qualifications ON public.pre_qualifications;
DROP TRIGGER IF EXISTS touch_tannoor_methods    ON public.tannoor_pricing_methods;
DROP TRIGGER IF EXISTS touch_tannoor_products   ON public.tannoor_products;
DROP TRIGGER IF EXISTS touch_tannoor_projects   ON public.tannoor_projects;
DROP TRIGGER IF EXISTS touch_tannoor_items      ON public.tannoor_items;

CREATE TRIGGER touch_client_projects    BEFORE UPDATE ON public.client_projects         FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_important_docs     BEFORE UPDATE ON public.important_documents     FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_pre_qualifications BEFORE UPDATE ON public.pre_qualifications      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_methods    BEFORE UPDATE ON public.tannoor_pricing_methods FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_products   BEFORE UPDATE ON public.tannoor_products        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_projects   BEFORE UPDATE ON public.tannoor_projects        FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_items      BEFORE UPDATE ON public.tannoor_items           FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─── 12. Promote elzubair.mail@gmail.com to super_admin ────────────────────
-- Creates the profiles row first if it's somehow missing — covers the edge
-- case where the user signed up before the auth.users → profiles trigger
-- was installed.

INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  'super_admin'
FROM auth.users u
WHERE LOWER(u.email) IN ('elzubair.mail@gmail.com', 'it@ghassl.com')
ON CONFLICT (id) DO UPDATE
SET role       = 'super_admin',
    updated_at = NOW();


-- ─── 13. Reload PostgREST cache ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Sanity check: row count for each of the new tables (should all be 0 on a
-- first run, or whatever you had before on re-runs).
SELECT
  (SELECT COUNT(*) FROM public.client_projects)          AS client_projects,
  (SELECT COUNT(*) FROM public.important_documents)      AS important_documents,
  (SELECT COUNT(*) FROM public.pre_qualifications)       AS pre_qualifications,
  (SELECT COUNT(*) FROM public.tannoor_pricing_methods)  AS pricing_methods,
  (SELECT COUNT(*) FROM public.tannoor_products)         AS products,
  (SELECT COUNT(*) FROM public.tannoor_projects)         AS tannoor_projects,
  (SELECT email, role FROM public.profiles
   WHERE LOWER(email) = 'elzubair.mail@gmail.com' LIMIT 1) AS your_role;
