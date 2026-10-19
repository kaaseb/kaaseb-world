// The contract every Kaaseb AI tool follows.
//
// SECURITY MODEL (why the assistant can "see everything" and still leak nothing):
//   1. A tool declares the permission(s) it needs. Tools the user lacks are
//      NEVER offered to the model — it cannot even ask for that data.
//   2. The runner re-checks the permission before executing (defense in depth:
//      a model that invents a tool name gets "not allowed", not data).
//   3. Every tool is READ-ONLY. There is no raw SQL / free query tool.
//   4. Results are trimmed to what an answer needs — no password hashes, no
//      tokens, no encrypted secrets ever leave a tool.

import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import { hasPermission, type PermissionKey } from '@/lib/permissions'
import type { AiCard } from './cards'

export interface ToolCtx {
  supabase: SupabaseClient
  user: Pick<User, 'id' | 'email'>
  profile: Profile
  permissions: string[]
  can: (key: PermissionKey) => boolean
  /** Register a card; returns its ref for the model to place with [[card:ref]]. */
  card: (c: DistributiveOmit<AiCard, 'ref'>) => string
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export interface AiTool {
  name: string
  /** What the model reads to decide when to call it. */
  description: string
  parameters: Record<string, unknown>
  /** ANY of these grants access. Empty = every signed-in user. */
  perms: PermissionKey[]
  /** Pages that only the super admin can open (finances, audit) stay that way. */
  adminOnly?: boolean
  /** Arabic status line shown while it runs ("يبحث في العروض…"). */
  status: string
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>
}

export function allowed(tool: AiTool, profile: Profile, permissions: string[]): boolean {
  if (tool.adminOnly) return profile.role === 'super_admin'
  return tool.perms.length === 0 || tool.perms.some((p) => hasPermission(profile, permissions, p))
}

// ── argument helpers (the model's args are untrusted input) ──────────────────
export const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const int = (v: unknown, def: number, min: number, max: number): number => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
export const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
/** ISO date (YYYY-MM-DD…) or ''. */
export const date = (v: unknown): string => {
  const s = str(v, 40)
  return s && !Number.isNaN(new Date(s).getTime()) ? new Date(s).toISOString() : ''
}
/** Safe for a PostgREST ilike pattern inside .or(): no commas/parens/wildcards. */
export const likeSafe = (v: string): string => v.replace(/[%_,()*\\"]/g, ' ').trim()

export const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()

/** "البروفايل" → "بروفايل": the article must not decide a match. */
const stripAl = (w: string) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w)

/** The model sends spellings as alternatives: "الراجحي|Al Rajhi". */
export function alternatives(q: string): string[] {
  return q.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 4)
}

/** ANY alternative whose every word appears in the haystack (Arabic-normalised,
 *  article-insensitive). */
export function matches(q: string, ...hay: unknown[]): boolean {
  const alts = alternatives(q)
  if (alts.length === 0) return true
  const h = norm(hay.filter(Boolean).join(' '))
  return alts.some((a) => {
    const words = norm(a).split(' ').filter(Boolean).map(stripAl)
    return words.length > 0 && words.every((w) => h.includes(w))
  })
}

/** PostgREST `.or()` filter: each column × each alternative, words in order
 *  with gaps allowed ("مؤسسة الراجحي" also finds "مؤسسة عبدالله الراجحي"). */
export function ilikeOr(cols: string[], q: string): string {
  const patterns = alternatives(q)
    .map((a) => likeSafe(a).split(/\s+/).filter(Boolean).map(stripAl).join('%'))
    .filter(Boolean)
  // Nothing searchable left → a filter that matches nothing (never "everything").
  if (!patterns.length) return `${cols[0]}.eq.__none__`
  return cols.flatMap((c) => patterns.map((p) => `${c}.ilike.%${p}%`)).join(',')
}

export function inRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (from && t < new Date(from).getTime()) return false
  if (to && t > new Date(to).getTime()) return false
  return true
}

export const DATE_ARGS = {
  from: { type: 'string', description: 'Start date ISO (YYYY-MM-DD), inclusive. Resolve relative dates ("this month", "أمس") yourself using today\'s date.' },
  to: { type: 'string', description: 'End date ISO (YYYY-MM-DD), inclusive end of day.' },
} as const

/** End-of-day for a bare YYYY-MM-DD "to" date. */
export function toEnd(v: unknown): string {
  const s = str(v, 40)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T23:59:59.999Z`).toISOString()
  return date(s)
}
