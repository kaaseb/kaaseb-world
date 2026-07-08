// Server-side helper that turns the /print/quotation/<id>/<qid> page into a
// real PDF using Puppeteer + the bundled Chromium that ships with the
// puppeteer package.
//
// Why Puppeteer rather than @react-pdf/renderer or hand-drawn pdf-lib:
//   • The existing print page already handles bilingual layout (RTL Arabic
//     + LTR English), Tajawal font, branding header, signature footer.
//     Re-implementing all of that in primitives would mean two layouts to
//     maintain instead of one.
//   • Puppeteer renders WHATEVER the browser would render, so the bucket
//     PDF and the on-screen print preview stay in lockstep forever.
//
// Trade-offs: each render boots Chromium (~150 MB resident). Acceptable for
// the once-per-quotation cadence; we share a single instance across calls
// within a process via `getBrowser()` so back-to-back AR+EN doesn't pay
// the startup cost twice.

import type { Browser } from 'puppeteer'

let _browser: Promise<Browser> | null = null
let _stopTimer: NodeJS.Timeout | null = null

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser
  // Lazy-import so this module doesn't pull Puppeteer into bundles that
  // never call it (e.g. anything that imports `@/lib/s3` for upload only).
  const puppeteer = (await import('puppeteer')).default
  _browser = puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--font-render-hinting=none', // crisper Arabic glyphs
    ],
  })
  return _browser
}

// Bring the browser back down after a short idle period so a long-running
// dev server doesn't hold ~150 MB forever just because someone clicked
// "Send" once. Re-armed on every render.
function scheduleShutdown() {
  if (_stopTimer) clearTimeout(_stopTimer)
  _stopTimer = setTimeout(async () => {
    const b = _browser
    _browser = null
    try { (await b)?.close() } catch { /* ignore */ }
  }, 60_000)
}

export interface RenderQuotationInput {
  /** Absolute origin (https://kaaseb.example) or http://localhost:3000 — the
   *  print page is server-rendered and we need a real URL. */
  origin: string
  projectId: string
  quotationId: string
  /** Cookie header to forward so the print page passes the auth check. We
   *  use the caller's session cookie so RLS still applies. */
  cookieHeader: string
}

export async function renderQuotationPdf(
  input: RenderQuotationInput
): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    // Forward the caller's cookies so the print page's Supabase auth check
    // sees an authenticated user. We pass them as URL-scoped cookies on the
    // origin so Puppeteer routes them on the request.
    const u = new URL(input.origin)
    const cookies = parseCookieHeader(input.cookieHeader).map(c => ({
      name: c.name,
      value: c.value,
      domain: u.hostname,
      path: '/',
      httpOnly: false,
      secure: u.protocol === 'https:',
      sameSite: 'Lax' as const,
    }))
    if (cookies.length > 0) await page.setCookie(...cookies)

    const url = `${input.origin}/print/quotation/${input.projectId}/${input.quotationId}`
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })

    // The print page auto-fires window.print() on mount, which Chromium
    // ignores in headless. Forcing the print CSS media here gives us the
    // print stylesheet anyway.
    await page.emulateMediaType('print')

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
    scheduleShutdown()
  }
}

function parseCookieHeader(header: string): Array<{ name: string; value: string }> {
  if (!header) return []
  return header.split(';').map(raw => {
    const eq = raw.indexOf('=')
    if (eq < 0) return { name: raw.trim(), value: '' }
    return { name: raw.slice(0, eq).trim(), value: raw.slice(eq + 1).trim() }
  }).filter(c => c.name)
}
