// Render an HTML string to a PDF via Puppeteer (page.setContent — no URL/route
// needed). Used for the pre-qualification Table of Contents, where we need
// proper Arabic shaping/RTL that pdf-lib can't do. Shares one Chromium across
// calls within a process and tears it down after an idle period.

import type { Browser } from 'puppeteer'

let _browser: Promise<Browser> | null = null
let _stopTimer: NodeJS.Timeout | null = null

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser
  const puppeteer = (await import('puppeteer')).default
  _browser = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  })
  return _browser
}

function scheduleShutdown() {
  if (_stopTimer) clearTimeout(_stopTimer)
  _stopTimer = setTimeout(async () => {
    const b = _browser
    _browser = null
    try { (await b)?.close() } catch { /* ignore */ }
  }, 60_000)
}

export async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    // Wait for the embedded web font (Tajawal) so Arabic renders shaped, not as
    // tofu boxes. Best-effort — never block the render if fonts stall.
    try { await page.evaluate(async () => { await document.fonts.ready }) } catch { /* ignore */ }
    await page.emulateMediaType('print')
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })
    return new Uint8Array(pdf)
  } finally {
    await page.close()
    scheduleShutdown()
  }
}
