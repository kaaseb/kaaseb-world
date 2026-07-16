// "الفرص" (Opportunities) — shared types + taxonomy.
//
// DEPENDENCY-FREE ON PURPOSE. Both the server (store, AI schema, validation)
// and the client (tabs, pills) import this file, so the sector list and the
// record shape can never drift between them. Do not import S3/OpenAI/Supabase
// here — that would drag server-only code into the browser bundle.

export type Lang = 'en' | 'ar'

// ─── Sectors (rendered as the page's tabs) ──────────────────────────────────
// The AI classifies every find into exactly one of these. Keys are stable and
// stored in S3; the labels are UI sugar only.
export const OPPORTUNITY_CATEGORIES = [
  { key: 'government', en: 'Government & Giga', ar: 'حكومية وعملاقة' },
  { key: 'developers', en: 'Developers & Towers', ar: 'مطوّرون وأبراج' },
  { key: 'commercial', en: 'Commercial & Hospitality', ar: 'تجاري وضيافة' },
  { key: 'landmark', en: 'Mosques, Palaces & Facades', ar: 'مساجد وقصور وواجهات' },
] as const

export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number]['key']

export const CATEGORY_KEYS: OpportunityCategory[] = OPPORTUNITY_CATEGORIES.map((c) => c.key)

export function isValidCategory(v: unknown): v is OpportunityCategory {
  return typeof v === 'string' && (CATEGORY_KEYS as string[]).includes(v)
}

export function categoryLabel(key: OpportunityCategory, lang: Lang): string {
  return OPPORTUNITY_CATEGORIES.find((c) => c.key === key)?.[lang] ?? key
}

// ─── Team workflow state ────────────────────────────────────────────────────
// The AI only ever writes 'new'. Everything else is the team's to set.
export const OPPORTUNITY_STATUSES = [
  { key: 'new', en: 'New', ar: 'جديدة' },
  { key: 'saved', en: 'Saved', ar: 'محفوظة' },
  { key: 'contacted', en: 'Contacted', ar: 'تم التواصل' },
  { key: 'archived', en: 'Archived', ar: 'مؤرشفة' },
] as const

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]['key']

export const STATUS_KEYS: OpportunityStatus[] = OPPORTUNITY_STATUSES.map((s) => s.key)

export function isValidStatus(v: unknown): v is OpportunityStatus {
  return typeof v === 'string' && (STATUS_KEYS as string[]).includes(v)
}

export function statusLabel(key: OpportunityStatus, lang: Lang): string {
  return OPPORTUNITY_STATUSES.find((s) => s.key === key)?.[lang] ?? key
}

// How far along the project is. Free-ish, but we constrain the AI to this set
// so the pills stay predictable.
export const OPPORTUNITY_STAGES = [
  { key: 'announced', en: 'Announced', ar: 'معلن' },
  { key: 'tender', en: 'Tender / Bidding', ar: 'مناقصة' },
  { key: 'awarded', en: 'Awarded', ar: 'تمت الترسية' },
  { key: 'under_construction', en: 'Under construction', ar: 'تحت التنفيذ' },
  { key: 'finishing', en: 'Finishing phase', ar: 'مرحلة التشطيب' },
  { key: 'unknown', en: 'Unknown', ar: 'غير محدد' },
] as const

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]['key']

export const STAGE_KEYS: OpportunityStage[] = OPPORTUNITY_STAGES.map((s) => s.key)

export function stageLabel(key: OpportunityStage, lang: Lang): string {
  return OPPORTUNITY_STAGES.find((s) => s.key === key)?.[lang] ?? key
}

// ─── Records ────────────────────────────────────────────────────────────────

// A public, business-level contact point for the entity behind the project.
// Company switchboards / tender desks / official channels — never a private
// individual's personal data.
export interface OpportunityContact {
  name: string // person or desk, e.g. "Procurement Department"
  role: string
  email: string
  phone: string
  website: string
  source: string // where this contact was found (URL or publication)
}

export interface Opportunity {
  id: string
  // What it is
  title: string // project name / headline
  summary: string // 1-3 sentences: what the project is
  category: OpportunityCategory
  stage: OpportunityStage
  city: string
  // Who is behind it
  owner: string // developer / contractor / government entity
  contacts: OpportunityContact[]
  // When we last ran the dedicated contact hunt for `owner`. Optional because
  // records created before the feature existed simply won't have it. null/absent
  // = never hunted (so the card shows the button rather than "none found").
  contactsFetchedAt?: string | null
  // Why we care + how to go after it
  relevance: string // the marble/granite scope we could win
  targeting: string // suggested approach, concrete steps
  score: number // 0-100 priority, AI-assigned
  // Provenance
  sourceUrls: string[]
  publishedAt: string | null // ISO date of the news item, if known
  // Team workflow (AI never writes these two)
  status: OpportunityStatus
  notes: string
  // Bookkeeping
  fingerprint: string // dedup key, see store.ts
  createdAt: string
  updatedAt: string
}

// A single scan run's outcome — surfaced in the page header so the team can
// see when the robot last worked and whether it failed.
export type ScanStatus = 'running' | 'done' | 'failed'
export type ScanTrigger = 'schedule' | 'manual'

export interface ScanRun {
  status: ScanStatus
  trigger: ScanTrigger
  by: string | null // display name for manual runs
  startedAt: string
  finishedAt: string | null
  found: number // how many the AI returned
  added: number // how many survived dedup and were stored
  error: string | null
}

export interface OpportunitiesState {
  items: Opportunity[]
  lastRun: ScanRun | null
}
