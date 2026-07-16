// "شركات مستهدفة" (Target Companies) — shared types + taxonomy.
//
// DEPENDENCY-FREE ON PURPOSE (same rule as lib/opportunities/types.ts): both the
// server and the browser import this, so nothing here may pull in S3/OpenAI.
//
// HOW THIS DIFFERS FROM "الفرص":
//   الفرص  = a PROJECT happening right now. Perishable — miss the window and
//            the marble is already bought.
//   شركات  = a COMPANY that buys marble for a living. Permanent. Once "لنكس
//            للمقاولات" is on the list with a procurement number, it stays
//            valuable for every project they ever win.
// One is a lead. The other is an account list. You need both.

export type Lang = 'en' | 'ar'

export const COMPANY_CATEGORIES = [
  { key: 'contractors', en: 'General Contractors', ar: 'مقاولات عامة' },
  { key: 'finishing', en: 'Finishing & Fit-out', ar: 'تشطيبات وديكور' },
  { key: 'developers', en: 'Real-estate Developers', ar: 'مطوّرون عقاريون' },
  { key: 'consultants', en: 'Consultants & Architects', ar: 'استشاريون ومكاتب هندسية' },
] as const

export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number]['key']

export const COMPANY_CATEGORY_KEYS: CompanyCategory[] = COMPANY_CATEGORIES.map((c) => c.key)

export function isValidCompanyCategory(v: unknown): v is CompanyCategory {
  return typeof v === 'string' && (COMPANY_CATEGORY_KEYS as string[]).includes(v)
}

export function companyCategoryLabel(key: CompanyCategory, lang: Lang): string {
  return COMPANY_CATEGORIES.find((c) => c.key === key)?.[lang] ?? key
}

// How big they are — drives how we approach them, so it's a field not a guess.
export const COMPANY_SIZES = [
  { key: 'giga', en: 'Giga / Tier 1', ar: 'عملاقة' },
  { key: 'large', en: 'Large', ar: 'كبيرة' },
  { key: 'medium', en: 'Medium', ar: 'متوسطة' },
  { key: 'small', en: 'Small', ar: 'صغيرة' },
  { key: 'unknown', en: 'Unknown', ar: 'غير محدد' },
] as const

export type CompanySize = (typeof COMPANY_SIZES)[number]['key']
export const COMPANY_SIZE_KEYS: CompanySize[] = COMPANY_SIZES.map((s) => s.key)

export function companySizeLabel(key: CompanySize, lang: Lang): string {
  return COMPANY_SIZES.find((s) => s.key === key)?.[lang] ?? key
}

// Team workflow — the AI only ever writes 'new'.
export const COMPANY_STATUSES = [
  { key: 'new', en: 'New', ar: 'جديدة' },
  { key: 'saved', en: 'Saved', ar: 'محفوظة' },
  { key: 'contacted', en: 'Contacted', ar: 'تم التواصل' },
  { key: 'client', en: 'Client', ar: 'عميل' },
  { key: 'archived', en: 'Archived', ar: 'مؤرشفة' },
] as const

export type CompanyStatus = (typeof COMPANY_STATUSES)[number]['key']
export const COMPANY_STATUS_KEYS: CompanyStatus[] = COMPANY_STATUSES.map((s) => s.key)

export function isValidCompanyStatus(v: unknown): v is CompanyStatus {
  return typeof v === 'string' && (COMPANY_STATUS_KEYS as string[]).includes(v)
}

export function companyStatusLabel(key: CompanyStatus, lang: Lang): string {
  return COMPANY_STATUSES.find((s) => s.key === key)?.[lang] ?? key
}

// Same shape as the opportunities contact so the shared hunt in
// lib/opportunities/contacts.ts feeds both features unchanged.
export interface CompanyContact {
  name: string
  role: string
  email: string
  phone: string
  website: string
  source: string
}

export interface TargetCompany {
  id: string
  name: string
  category: CompanyCategory
  size: CompanySize
  city: string
  summary: string // what they build
  projects: string // notable projects — the proof they're worth chasing
  whyRelevant: string // the marble volume/type they realistically consume
  targeting: string // concrete approach, in Arabic
  contacts: CompanyContact[]
  contactsFetchedAt?: string | null
  score: number // 0-100
  sourceUrls: string[]
  // Team workflow (AI never writes these two)
  status: CompanyStatus
  notes: string
  // Bookkeeping
  fingerprint: string
  createdAt: string
  updatedAt: string
}

export type CompanyScanStatus = 'running' | 'done' | 'failed'
export type CompanyScanTrigger = 'schedule' | 'manual'

export interface CompanyScanRun {
  status: CompanyScanStatus
  trigger: CompanyScanTrigger
  by: string | null
  startedAt: string
  finishedAt: string | null
  found: number
  added: number
  error: string | null
}

export interface CompaniesState {
  items: TargetCompany[]
  lastRun: CompanyScanRun | null
}
