'use client'

// Tiny client-side pager. Given a sorted list, slice it into pages and
// hand the caller (a) the slice for the active page and (b) a UI to flip
// pages. Used by every long list view in the app — keeps the chrome and
// keyboard behaviour consistent.

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

// Sliding-window page numbers. Always show first + last; show neighbours
// of the current page; gap them with "…" when there's a gap.
function paginationWindow(total: number, current: number, around = 1): Array<number | '…'> {
  if (total <= 1) return [1]
  const out: Array<number | '…'> = []
  const push = (n: number) => { if (out[out.length - 1] !== n) out.push(n) }
  push(1)
  const start = Math.max(2, current - around)
  const end   = Math.min(total - 1, current + around)
  if (start > 2) out.push('…')
  for (let i = start; i <= end; i++) push(i)
  if (end < total - 1) out.push('…')
  if (total > 1) push(total)
  return out
}

export function usePagination<T>({ items, perPage, page }: {
  items: T[]
  perPage: number
  page: number
}): { slice: T[]; pageCount: number; safePage: number; total: number } {
  return useMemo(() => {
    const total = items.length
    const pageCount = Math.max(1, Math.ceil(total / perPage))
    const safePage = Math.min(Math.max(1, page), pageCount)
    const start = (safePage - 1) * perPage
    return {
      slice: items.slice(start, start + perPage),
      pageCount,
      safePage,
      total,
    }
  }, [items, perPage, page])
}

export function Pagination({ page, pageCount, onChange, perPage, total, isRtl }: {
  page: number
  pageCount: number
  onChange: (next: number) => void
  perPage: number
  total: number
  isRtl?: boolean
}) {
  if (pageCount <= 1) return null
  const cells = paginationWindow(pageCount, page)
  const FirstIcon = isRtl ? ChevronsRight : ChevronsLeft
  const PrevIcon  = isRtl ? ChevronRight  : ChevronLeft
  const NextIcon  = isRtl ? ChevronLeft   : ChevronRight
  const LastIcon  = isRtl ? ChevronsLeft  : ChevronsRight
  const startRow = (page - 1) * perPage + 1
  const endRow   = Math.min(page * perPage, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t bg-muted/20">
      <p className="text-xs text-muted-foreground" dir="ltr">
        {startRow}–{endRow} / {total}
      </p>
      <nav className="inline-flex items-center gap-0.5">
        <PageBtn aria-label="First"    disabled={page <= 1}          onClick={() => onChange(1)}><FirstIcon className="w-4 h-4" /></PageBtn>
        <PageBtn aria-label="Previous" disabled={page <= 1}          onClick={() => onChange(page - 1)}><PrevIcon className="w-4 h-4" /></PageBtn>
        {cells.map((c, i) =>
          c === '…'
            ? <span key={`g${i}`} className="px-2 text-muted-foreground/60 text-sm">…</span>
            : (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                className={`h-8 min-w-8 px-2 rounded-md text-sm font-medium transition ${
                  c === page
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/70 hover:bg-muted'
                }`}
              >
                {c}
              </button>
            )
        )}
        <PageBtn aria-label="Next" disabled={page >= pageCount} onClick={() => onChange(page + 1)}><NextIcon className="w-4 h-4" /></PageBtn>
        <PageBtn aria-label="Last" disabled={page >= pageCount} onClick={() => onChange(pageCount)}><LastIcon className="w-4 h-4" /></PageBtn>
      </nav>
    </div>
  )
}

function PageBtn({ children, disabled, onClick, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-foreground/70 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition"
      {...rest}
    >
      {children}
    </button>
  )
}
