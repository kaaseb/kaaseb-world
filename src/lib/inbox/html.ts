// Email HTML handling for the reader.
//
// The full message body is shown so the team can verify the AI's extraction
// against the real email. Two safety layers protect us from a hostile customer
// message: (1) this sanitizer strips <script>/<iframe>, inline on* handlers and
// javascript: URLs; (2) the reader renders the result inside a SANDBOXED iframe
// with NO allow-scripts, so even anything that slips through can't execute. We
// also collect every link so the team can eyeball the cloud-file URLs.

export function sanitizeEmailHtml(html: string): string {
  if (!html) return ''
  let out = html
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
  out = out.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
  out = out.replace(/<embed\b[^>]*>/gi, '')
  // Inline event handlers (onclick=, onload=, …) in any quoting style.
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  out = out.replace(/javascript:/gi, '')
  return out.slice(0, 400_000)
}

// Every distinct http(s) link in the message — from HTML hrefs AND bare text
// URLs — so the team can check the files behind cloud links (Drive/Dropbox/WeTransfer).
export function extractLinks(html: string, text: string): string[] {
  const urls = new Set<string>()
  const push = (raw: string) => {
    const v = (raw || '').trim().replace(/[)\].,;"'<>]+$/, '')
    if (/^https?:\/\//i.test(v) && v.length <= 2000) urls.add(v)
  }
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = hrefRe.exec(html || '')) !== null && urls.size < 200) push(m[1])
  const urlRe = /https?:\/\/[^\s<>"')]+/gi
  while ((m = urlRe.exec(text || '')) !== null && urls.size < 200) push(m[0])
  return Array.from(urls).slice(0, 60)
}
