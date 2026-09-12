// Find file links inside free text (an RFQ email, project notes) and say what
// can be done with each one — deterministically, no network.
//
// Why this exists: a client "sends the BOQ" as SharePoint / Drive / WeTransfer
// links in the email body. The intake keeps that text as notes; nothing used
// to read the links. Now they surface on the Furn project, each with a «جلب»
// button that runs the link engine (src/lib/links/resolve.ts). `likelyLogin`
// is only a hint shown next to SharePoint/OneDrive links (most corporate share
// links are sign-in gated); the attempt itself decides.
//
// Pure; covered by tests/links.test.ts.

export type LinkKind = 'sharepoint' | 'onedrive' | 'gdrive' | 'dropbox' | 'wetransfer' | 'gofile' | 'mediafire' | 'mega' | 'direct' | 'web'

export interface DiscoveredLink {
  url: string
  /** Best label from the surrounding text ("Stone & Marble"), else the host. */
  label: string
  kind: LinkKind
  /** Hint only: corporate share links usually sit behind a sign-in. */
  likelyLogin: boolean
}

const URL_RE = /https?:\/\/[^\s<>"'()\[\]]+/g
const FILE_EXT_RE = /\.(xlsx?|csv|pdf|docx?|dwg|dxf|zip|rar|7z|png|jpe?g|webp)(?:[?#]|$)/i

function kindOf(u: URL): LinkKind {
  const h = u.hostname.toLowerCase()
  if (h.endsWith('.sharepoint.com')) return 'sharepoint'
  if (h === '1drv.ms' || h.endsWith('onedrive.live.com') || h.endsWith('onedrive.com')) return 'onedrive'
  if (h.endsWith('drive.google.com') || h.endsWith('docs.google.com')) return 'gdrive'
  if (h.endsWith('dropbox.com')) return 'dropbox'
  if (h.endsWith('wetransfer.com') || h.endsWith('we.tl')) return 'wetransfer'
  if (h.endsWith('gofile.io')) return 'gofile'
  if (h.endsWith('mediafire.com')) return 'mediafire'
  if (h.endsWith('mega.nz') || h.endsWith('mega.co.nz')) return 'mega'
  if (FILE_EXT_RE.test(u.pathname)) return 'direct'
  return 'web'
}

/** Trailing punctuation an email client glues onto a URL. */
function trimUrl(raw: string): string {
  return raw.replace(/[>.,;:!?)\]]+$/g, '')
}

/** Label from text right before the URL: "<Stone & Marble<https://…" (Outlook
 *  plain-text), "Stone & Marble: https://…", or "[Stone & Marble](https://…)". */
function labelBefore(text: string, at: number): string | null {
  const before = text.slice(Math.max(0, at - 80), at)
  const m =
    /<?\s*([^<>\n\[\]]{2,60}?)\s*<\s*$/.exec(before) ||   // "<Label<https"
    /\[([^\]\n]{2,60})\]\(\s*$/.exec(before) ||           // "[Label](https"
    /(?:^|\n)\s*([^\n:]{2,60}?)\s*[:：]\s*$/.exec(before) || // "Label: https"
    /(?:^|\n)\s*([^\n:.,;!?]{2,40}?)\s+$/.exec(before)     // "Label https" (short, same line)
  const label = m?.[1]?.trim().replace(/^[-•*\s]+/, '')
  return label && !/^https?:/i.test(label) ? label : null
}

export function discoverFileLinks(text: string | null | undefined): DiscoveredLink[] {
  const src = text || ''
  const out: DiscoveredLink[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(src)) !== null) {
    const url = trimUrl(m[0])
    let u: URL
    try { u = new URL(url) } catch { continue }
    // Inline images / tracking pixels / mail-client noise are not files.
    if (/^cid:/i.test(url) || /(?:unsubscribe|safelinks\.protection|mailtrack|pixel)/i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const kind = kindOf(u)
    if (kind === 'web') continue // plain web pages are not file links
    const label = labelBefore(src, m.index) || u.hostname.replace(/^www\./, '')
    out.push({ url, label, kind, likelyLogin: kind === 'sharepoint' })
  }
  return out
}

/** Which Furn bucket a fetched/uploaded file belongs in, from its name. */
export function bucketForFile(name: string): 'boq' | 'spec' | 'drawing' | 'other' {
  const n = (name || '').toLowerCase()
  if (/\.(xlsx?|csv)$/.test(n) || /\b(boq|bill of quant|جدول الكميات|كميات)\b/.test(n)) return 'boq'
  if (/\.(dwg|dxf|png|jpe?g|webp)$/.test(n) || /\b(drawing|drawings|plan|elevation|section|مخطط|رسم|رسومات|لوحة)\b/.test(n)) return 'drawing'
  if (/\.(pdf|docx?)$/.test(n)) return 'spec'
  return 'other'
}

/** The intake stores the email body as a ".txt" placeholder in the BOQ bucket
 *  when nothing better exists — recognise it so real BOQs can replace it. */
export function isEmailBodyPlaceholder(name: string): boolean {
  return /^نص-الإيميل/.test(name || '') || /email-body|نص-الايميل/i.test(name || '')
}
