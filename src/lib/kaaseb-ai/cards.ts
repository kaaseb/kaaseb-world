// Cards Kaaseb AI shows under (or inside) a reply.
//
// SECURITY: a card is built ONLY on the server, from a real record the user is
// allowed to see. The model never writes a card or a link — it can only point
// at a card a tool already produced (`[[card:<ref>]]`). So a prompt-injected
// email or a confused model can't put a fake "Download" button in front of
// anyone. Every href is an in-app path (validated again on render).

export type Tone = 'emerald' | 'amber' | 'red' | 'blue' | 'violet' | 'slate'

/** Download = blue, Edit = red, Open = neutral — one meaning per colour. */
export type ActionKind = 'download' | 'edit' | 'open'

export interface CardAction {
  kind: ActionKind
  label: string
  href: string
  /** Open in a new tab (PDFs, files). */
  external?: boolean
}

export interface CardField {
  label: string
  value: string
}

export interface CardStat {
  label: string
  value: string
  tone?: Tone
  hint?: string
}

export type AiCard =
  | {
      type: 'record'
      ref: string
      /** Small caps line above the title: "عرض سعر يدوي", "مشروع فرن"… */
      kind: string
      title: string
      subtitle?: string
      badge?: { label: string; tone: Tone }
      /** The one number that matters (total, items…). */
      amount?: string
      fields?: CardField[]
      actions?: CardAction[]
    }
  | {
      type: 'stats'
      ref: string
      title: string
      stats: CardStat[]
    }
  | {
      type: 'list'
      ref: string
      title: string
      total?: number
      rows: Array<{
        title: string
        subtitle?: string
        meta?: string
        badge?: { label: string; tone: Tone }
        href?: string
      }>
      more?: { label: string; href: string }
    }

const SAFE_HREF = /^\/(?!\/)[\w\-./?=&%#:+,@~؀-ۿ]*$/

/** In-app paths only — never another origin, never javascript:. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null
  return SAFE_HREF.test(href) ? href : null
}

/** What the browser will follow: an in-app path, or an https file URL the
 *  SERVER already verified as our own bucket (see tools/util fileAction). */
export function renderableHref(href: string | null | undefined): string | null {
  if (!href) return null
  if (safeHref(href)) return href
  try { return new URL(href).protocol === 'https:' ? href : null } catch { return null }
}

export function action(kind: ActionKind, label: string, href: string | null | undefined, external = false): CardAction | null {
  const h = safeHref(href)
  return h ? { kind, label, href: h, external } : null
}

export const compact = <T,>(xs: Array<T | null | undefined | false>): T[] => xs.filter(Boolean) as T[]

export function money(n: number | null | undefined, currency = 'SAR'): string {
  const v = Number(n) || 0
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ar-SA-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' })
}
