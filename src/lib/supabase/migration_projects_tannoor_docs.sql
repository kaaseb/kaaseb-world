-- ════════════════════════════════════════════════════════════════════════════
-- Kaaseb — Projects + Tannoor + Important Documents
-- ════════════════════════════════════════════════════════════════════════════
-- Additive migration. Safe to run on a database that already has the base
-- Kaaseb schema applied. Idempotent (IF NOT EXISTS / ON CONFLICT everywhere)
-- so re-runs are no-ops.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. CLIENT PROJECTS (CRM-style pipeline, distinct from the existing kanban
--    `projects` table)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Bilingual identity (Arabic + English duplicated; either may be NULL but
  -- not both — enforced at the API layer to keep this DDL simple).
  name_en             TEXT,
  name_ar             TEXT,
  company_en          TEXT,
  company_ar          TEXT,
  engineer_name_en    TEXT,
  engineer_name_ar    TEXT,
  engineer_phone      TEXT,
  end_date            DATE,
  -- Lifecycle fields. Free-text on purpose so the team can rename the
  -- pipeline without a DB migration; the UI lists the canonical values.
  status              TEXT NOT NULL DEFAULT 'new',
  stage               TEXT NOT NULL DEFAULT 'plans_intake',
  notes               TEXT,
  -- {url, name, key, kind} per item. Lives as JSONB so we can attach
  -- arbitrary numbers of files without spawning a side table.
  files               JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_projects_status   ON public.client_projects(status);
CREATE INDEX IF NOT EXISTS idx_client_projects_stage    ON public.client_projects(stage);
CREATE INDEX IF NOT EXISTS idx_client_projects_end_date ON public.client_projects(end_date);
CREATE INDEX IF NOT EXISTS idx_client_projects_created  ON public.client_projects(created_at DESC);

ALTER TABLE public.client_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_projects_all ON public.client_projects;
CREATE POLICY client_projects_all ON public.client_projects
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 2. IMPORTANT DOCUMENTS (commercial register, certifications, etc.)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.important_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en      TEXT,
  name_ar      TEXT,
  -- The actual PDF lives in S3; we just store the URL + filename for display.
  file_url     TEXT NOT NULL,
  file_name    TEXT,
  file_key     TEXT,                -- S3 object key (for cleanup on delete)
  expiry_date  DATE,                -- NULL = no expiry
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_important_docs_expiry ON public.important_documents(expiry_date);

ALTER TABLE public.important_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS important_documents_all ON public.important_documents;
CREATE POLICY important_documents_all ON public.important_documents
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 3. PRE-QUALIFICATIONS
-- ──────────────────────────────────────────────────────────────────────────
-- Each row represents a generated pre-qual packet: company + project +
-- ordered list of document_ids that go into the merged PDF. The rendered
-- PDF URL is stored in `output_pdf_url`; the source docs stay normalized
-- in `important_documents`.

CREATE TABLE IF NOT EXISTS public.pre_qualifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_en        TEXT,
  company_ar        TEXT,
  project_name_en   TEXT,
  project_name_ar   TEXT,
  -- Document IDs in render order. NULL items are allowed (placeholder pages).
  document_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  -- Whether to stamp signature/seal on EACH page or only the last page.
  -- 'last' is the common case (one signature page at the end), 'all' is for
  -- bidding packets where every page needs a signature.
  stamp_mode        TEXT NOT NULL DEFAULT 'last'
                         CHECK (stamp_mode IN ('last', 'all', 'none')),
  output_pdf_url    TEXT,                -- S3 URL after render
  output_pdf_key    TEXT,                -- S3 key for cleanup
  generated_at      TIMESTAMPTZ,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pre_qual_created ON public.pre_qualifications(created_at DESC);

ALTER TABLE public.pre_qualifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pre_qualifications_all ON public.pre_qualifications;
CREATE POLICY pre_qualifications_all ON public.pre_qualifications
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 4. TANNOOR — PRICING METHODS
-- ──────────────────────────────────────────────────────────────────────────
-- Reusable description of "how this item is priced". The Tannoor AI gets
-- the description as context so it knows when to apply a given method.

CREATE TABLE IF NOT EXISTS public.tannoor_pricing_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en       TEXT,
  name_ar       TEXT,
  description_en TEXT,
  description_ar TEXT,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tannoor_pricing_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tannoor_pricing_methods_all ON public.tannoor_pricing_methods;
CREATE POLICY tannoor_pricing_methods_all ON public.tannoor_pricing_methods
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 5. TANNOOR — PRODUCTS
-- ──────────────────────────────────────────────────────────────────────────
-- Catalog of items the company supplies. Each product is tied to one of the
-- furn_departments (Marble / Granite / …) and references a pricing method.
-- The Tannoor BOQ analyzer matches incoming BOQ line items against this
-- catalog and uses the SAR/USD price directly — no manual pricing step.

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

CREATE INDEX IF NOT EXISTS idx_tannoor_products_dept    ON public.tannoor_products(department_id);
CREATE INDEX IF NOT EXISTS idx_tannoor_products_method  ON public.tannoor_products(pricing_method_id);

ALTER TABLE public.tannoor_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tannoor_products_all ON public.tannoor_products;
CREATE POLICY tannoor_products_all ON public.tannoor_products
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 6. TANNOOR — PROJECTS
-- ──────────────────────────────────────────────────────────────────────────
-- Mirrors `furn_projects` but skips the pricing stage entirely — the AI
-- emits a fully-priced quotation by joining matched products' prices.
-- `missing_products` is set TRUE by the analyzer when at least one BOQ
-- line couldn't be matched to a product in the catalog, surfacing the
-- "ناقص منتجات" status to the UI without a separate column.

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
                                CHECK (status IN (
                                  'pending', 'in_progress', 'completed',
                                  'rejected', 'archived', 'missing_products'
                                )),
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

CREATE INDEX IF NOT EXISTS idx_tannoor_projects_created  ON public.tannoor_projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tannoor_projects_stage    ON public.tannoor_projects(stage);
CREATE INDEX IF NOT EXISTS idx_tannoor_projects_status   ON public.tannoor_projects(status);

ALTER TABLE public.tannoor_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tannoor_projects_all ON public.tannoor_projects;
CREATE POLICY tannoor_projects_all ON public.tannoor_projects
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 7. TANNOOR — PROJECT ITEMS (matched BOQ lines)
-- ──────────────────────────────────────────────────────────────────────────
-- Each row is one priced line in the resulting quotation. `product_id` is
-- non-NULL when the AI matched the BOQ description to a catalog product;
-- otherwise the row reflects a "missing" item and the status flag on the
-- parent project flips to 'missing_products'.

CREATE TABLE IF NOT EXISTS public.tannoor_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  position        INT NOT NULL DEFAULT 1,
  description     TEXT NOT NULL,
  quantity        NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit            TEXT NOT NULL DEFAULT 'm',
  product_id      UUID REFERENCES public.tannoor_products(id) ON DELETE SET NULL,
  unit_price      NUMERIC(14, 2),
  currency        TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR', 'USD')),
  notes           TEXT,
  is_missing      BOOLEAN NOT NULL DEFAULT FALSE,
  ai_confidence   NUMERIC(4, 3),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tannoor_items_project ON public.tannoor_items(project_id, position);

ALTER TABLE public.tannoor_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tannoor_items_all ON public.tannoor_items;
CREATE POLICY tannoor_items_all ON public.tannoor_items
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 8. TANNOOR — QUOTATIONS (frozen snapshots)
-- ──────────────────────────────────────────────────────────────────────────
-- Same shape as furn_quotations so the print page can be near-identical.

CREATE TABLE IF NOT EXISTS public.tannoor_quotations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.tannoor_projects(id) ON DELETE CASCADE,
  quotation_number INT NOT NULL UNIQUE,
  language         TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','en')),
  currency         TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','USD')),
  vat_rate         NUMERIC(5, 4) NOT NULL DEFAULT 0.15,
  subtotal         NUMERIC(16, 2) NOT NULL DEFAULT 0,
  vat_amount       NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total            NUMERIC(16, 2) NOT NULL DEFAULT 0,
  pdf_url          TEXT,
  generated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tannoor_quotations_project ON public.tannoor_quotations(project_id, generated_at DESC);

ALTER TABLE public.tannoor_quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tannoor_quotations_all ON public.tannoor_quotations;
CREATE POLICY tannoor_quotations_all ON public.tannoor_quotations
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);


-- ──────────────────────────────────────────────────────────────────────────
-- 9. Tannoor settings (singleton — borrows furn_settings' role).
--    We add the quotation-number counter so Tannoor has its own series,
--    and the seal image URL on top of furn_settings.signature_image_url
--    (which is reused for the manager signature on Pre-qualification too).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.furn_settings
  ADD COLUMN IF NOT EXISTS seal_image_url           TEXT,
  ADD COLUMN IF NOT EXISTS next_tannoor_number      INT NOT NULL DEFAULT 5000;


-- ──────────────────────────────────────────────────────────────────────────
-- 10. updated_at touchers for the new tables (reuse public.touch_updated_at)
-- ──────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    -- Function already declared by the main schema; just wire the triggers.
    NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS touch_client_projects     ON public.client_projects;
DROP TRIGGER IF EXISTS touch_important_docs      ON public.important_documents;
DROP TRIGGER IF EXISTS touch_pre_qualifications  ON public.pre_qualifications;
DROP TRIGGER IF EXISTS touch_tannoor_methods     ON public.tannoor_pricing_methods;
DROP TRIGGER IF EXISTS touch_tannoor_products    ON public.tannoor_products;
DROP TRIGGER IF EXISTS touch_tannoor_projects    ON public.tannoor_projects;
DROP TRIGGER IF EXISTS touch_tannoor_items       ON public.tannoor_items;

CREATE TRIGGER touch_client_projects    BEFORE UPDATE ON public.client_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_important_docs     BEFORE UPDATE ON public.important_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_pre_qualifications BEFORE UPDATE ON public.pre_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_methods    BEFORE UPDATE ON public.tannoor_pricing_methods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_products   BEFORE UPDATE ON public.tannoor_products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_projects   BEFORE UPDATE ON public.tannoor_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_tannoor_items      BEFORE UPDATE ON public.tannoor_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


NOTIFY pgrst, 'reload schema';
COMMIT;
