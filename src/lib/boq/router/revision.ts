// Drawing revisions — "A-301 Rev C" beats "A-301 Rev A".
//
// A project package routinely carries several issues of the same sheet. The
// design rule (ROUTER-DESIGN.md) is "prefer the latest, surface both when
// unsure"; until now nothing read the revision at all. This module parses a
// revision token deterministically (file name, title, first-page text), groups
// files by sheet (doc number, else the name stem with the revision stripped),
// and reports which files are SUPERSEDED by a newer issue. Used to steer the
// router away from old issues and to warn when a number came from one.
//
// Pure; covered by tests/revision.test.ts.

export interface RevisionSource {
  sha: string
  name: string
  docNumber: string | null
  title: string | null
  /** First page text (optional) — title blocks often carry "REV: C". */
  firstPageText?: string | null
}

export interface Superseded {
  rev: string
  latest: string
  latestName: string
}

const REV_PATTERNS: RegExp[] = [
  /\b(?:rev(?:ision)?|revised|issue)\s*[.:#_\-]?\s*([a-z]{1,2}|\d{1,3})(?![a-z0-9])/i,
  /(?:^|[\s_\-(])r(\d{1,2})(?=[\s_\-).]|$)/i, // "A-301_R2.pdf", "A301 (R1)"
  /(?:إصدار|مراجعة|تنقيح|نسخة)\s*[:#\-]?\s*([a-z]{1,2}|\d{1,3})(?![a-z0-9])/i,
]

/** First revision token found across the given sources, normalised (upper-case). */
export function parseRevision(...sources: Array<string | null | undefined>): string | null {
  for (const s of sources) {
    if (!s) continue
    // Strip the extension so "Rev.pdf" style noise can't match.
    const text = s.replace(/\.(pdf|dwg|dxf|png|jpe?g|xlsx?|csv|docx?)$/i, '')
    for (const re of REV_PATTERNS) {
      const m = re.exec(text)
      if (m) return m[1].toUpperCase()
    }
  }
  return null
}

/** >0 when `a` is newer than `b`, <0 when older, 0 when equal or not comparable. */
export function compareRevision(a: string, b: string): number {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (!na && !nb) return a.localeCompare(b, 'en', { sensitivity: 'base' })
  return 0 // a letter vs a number — conventions differ, don't guess
}

function normDoc(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '')
}

/** Group key: the doc number when known, else the file-name stem with the
 *  revision token removed — so "A-301 Rev A.pdf" and "A-301 Rev C.pdf" meet. */
export function docKey(name: string, docNumber: string | null | undefined): string {
  if (docNumber && docNumber.trim()) return `doc:${normDoc(docNumber)}`
  let stem = name.replace(/\.[a-z0-9]+$/i, '')
  for (const re of REV_PATTERNS) stem = stem.replace(re, ' ')
  return `name:${normDoc(stem)}`
}

/** sha → superseded-info for every file that has a NEWER issue in the set. */
export function supersededMap(files: RevisionSource[]): Map<string, Superseded> {
  const groups = new Map<string, Array<{ sha: string; name: string; rev: string }>>()
  for (const f of files) {
    const rev = parseRevision(f.name, f.title, f.firstPageText)
    if (!rev) continue
    const key = docKey(f.name, f.docNumber)
    const g = groups.get(key) || []
    g.push({ sha: f.sha, name: f.name, rev })
    groups.set(key, g)
  }
  const out = new Map<string, Superseded>()
  for (const g of groups.values()) {
    if (g.length < 2) continue
    let latest = g[0]
    for (const m of g) if (compareRevision(m.rev, latest.rev) > 0) latest = m
    for (const m of g) {
      if (m.sha !== latest.sha && compareRevision(latest.rev, m.rev) > 0) {
        out.set(m.sha, { rev: m.rev, latest: latest.rev, latestName: latest.name })
      }
    }
  }
  return out
}
