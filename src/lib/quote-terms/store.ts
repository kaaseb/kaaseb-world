// Quotation Terms & Conditions — a GLOBAL bilingual default (set once by the
// admin) plus an optional PER-QUOTE override (enable/disable, language, and
// custom bullet lines). Everything lives in S3 — no DB columns.
//
// A per-quote key is `<scope>:<id>` where scope ∈ furn | tannoor | manual.
// resolveQuoteTerms() combines the two for the print page.

import { readJson, writeJson } from '@/lib/s3'

const GLOBAL_KEY = 'app-data/quote-terms-global.json'
const OVERRIDE_KEY = 'app-data/quote-terms-overrides.json'

export interface GlobalTerms {
  ar: string[]
  en: string[]
  defaultEnabled: boolean
}
export interface TermsOverride {
  enabled?: boolean
  lang?: 'ar' | 'en'
  terms?: string[] | null // null/absent = use the global default for the language
}

const DEFAULT_GLOBAL: GlobalTerms = {
  ar: [
    'الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة ما لم يُذكر خلاف ذلك.',
    'العرض ساري لمدة (٣٠) يوماً من تاريخه.',
    'التوريد والتركيب حسب المتفق عليه في بنود العرض.',
    'الدفع حسب الشروط المتفق عليها قبل بدء التنفيذ.',
  ],
  en: [
    'Prices are in SAR and include VAT unless otherwise stated.',
    'This offer is valid for (30) days from its date.',
    'Supply and installation as agreed in the offer items.',
    'Payment as per the agreed terms before execution begins.',
  ],
  defaultEnabled: false,
}

function cleanLines(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x ?? '').slice(0, 300)).map((s) => s.trim()).filter(Boolean).slice(0, 40)
}

export async function getGlobalTerms(): Promise<GlobalTerms> {
  const g = await readJson<Partial<GlobalTerms>>(GLOBAL_KEY, {})
  return {
    ar: Array.isArray(g?.ar) ? cleanLines(g.ar) : DEFAULT_GLOBAL.ar,
    en: Array.isArray(g?.en) ? cleanLines(g.en) : DEFAULT_GLOBAL.en,
    defaultEnabled: g?.defaultEnabled === true,
  }
}

export async function setGlobalTerms(t: GlobalTerms): Promise<GlobalTerms> {
  const clean: GlobalTerms = { ar: cleanLines(t?.ar), en: cleanLines(t?.en), defaultEnabled: !!t?.defaultEnabled }
  await writeJson(GLOBAL_KEY, clean)
  return clean
}

type OverrideMap = Record<string, TermsOverride>

export async function getOverride(key: string): Promise<TermsOverride | null> {
  const m = await readJson<OverrideMap>(OVERRIDE_KEY, {})
  return m[key] || null
}

export async function setOverride(key: string, ov: TermsOverride): Promise<void> {
  const m = await readJson<OverrideMap>(OVERRIDE_KEY, {})
  m[key] = {
    enabled: typeof ov.enabled === 'boolean' ? ov.enabled : undefined,
    lang: ov.lang === 'ar' || ov.lang === 'en' ? ov.lang : undefined,
    terms: Array.isArray(ov.terms) ? cleanLines(ov.terms) : null,
  }
  await writeJson(OVERRIDE_KEY, m)
}

// Print-time resolution: is a T&C block shown, in which language, and what lines?
export async function resolveQuoteTerms(key: string, quoteLang: 'ar' | 'en'): Promise<{ show: boolean; lang: 'ar' | 'en'; lines: string[] }> {
  const [global, ov] = await Promise.all([getGlobalTerms(), getOverride(key)])
  const enabled = ov?.enabled ?? global.defaultEnabled
  if (!enabled) return { show: false, lang: quoteLang, lines: [] }
  const lang = ov?.lang || quoteLang
  const lines = ov?.terms && ov.terms.length ? ov.terms : (lang === 'ar' ? global.ar : global.en)
  return { show: lines.length > 0, lang, lines }
}
