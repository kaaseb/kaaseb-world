-- ── AI settings (singleton) ─────────────────────────────────────────────────
-- Central switch for the LLM provider that powers the whole app:
--   • Furn BOQ extraction      (src/lib/furn/boq.ts)
--   • Tannoor BOQ matching     (src/lib/tannoor/boq.ts)
--   • Kaaseb AI chat assistant (src/app/api/ai/chat/route.ts)
--
-- `openai_api_key` stores an AES-256-GCM envelope produced by
-- src/lib/encryption.ts (encryptSecret) — never plaintext. The runtime reads
-- this row with the service-role (admin) client and decrypts on the server;
-- the settings API never returns the raw key to the browser.
--
-- Idempotent: safe to run on an existing database.

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Active provider. Everything in the app routes through whichever is set.
  provider         TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'gemini')),
  -- Encrypted OpenAI API key (envelope string). NULL → fall back to env OPENAI_API_KEY.
  openai_api_key   TEXT,
  -- Model used for the chat assistant (tool/function calling).
  openai_model     TEXT NOT NULL DEFAULT 'gpt-5.4-mini',
  -- Model used for document/BOQ extraction (needs vision + structured output).
  openai_boq_model TEXT NOT NULL DEFAULT 'gpt-5.4',
  -- Gemini model kept so the legacy provider stays switchable.
  gemini_model     TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Seed the singleton row.
INSERT INTO public.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: mirror the app's internal-trust model (authenticated staff can read the
-- row; the encrypted key is never decrypted client-side and the GET API masks
-- it). Writes are additionally gated to super_admin inside the API route.
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_settings' AND policyname = 'ai_settings_auth_all'
  ) THEN
    CREATE POLICY ai_settings_auth_all ON public.ai_settings
      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;

-- Keep updated_at fresh on every write (the touch_updated_at() trigger fn is
-- defined in SCHEMA.sql).
DROP TRIGGER IF EXISTS touch_ai_settings ON public.ai_settings;
CREATE TRIGGER touch_ai_settings BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
