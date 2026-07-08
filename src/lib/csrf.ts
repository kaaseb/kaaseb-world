// CSRF protection via Origin/Referer validation.
//
// Rationale: Supabase's session cookie is SameSite=Lax which already blocks
// most cross-site forged POSTs. This adds a server-side check on the Origin
// header (with Referer as a fallback) so that even if someone disables
// SameSite or finds a corner case (subdomain, browser bug, fetch with
// credentials from a malicious site), the request is rejected.
//
// We verify the Origin header equals one of the app's allowed origins. The
// allow-list is built from:
//   - process.env.NEXT_PUBLIC_APP_URL (set this in production)
//   - the request's own Host header (so dev / preview deploys work without
//     extra config — but we trust it only because we're already past the
//     proxy/middleware that bound the request to our domain)
//
// Apply to state-changing handlers:
//
//   export async function POST(request: Request) {
//     const csrfError = verifyOrigin(request)
//     if (csrfError) return csrfError
//     ...
//   }

import { NextResponse } from 'next/server'

function allowedOrigins(request: Request): Set<string> {
  const set = new Set<string>()
  const env = process.env.NEXT_PUBLIC_APP_URL
  if (env) {
    try { set.add(new URL(env).origin) } catch { /* ignore bad env */ }
  }
  // Use the request's Host so the app boots on local dev / preview without
  // needing the env var. This is safe here: by the time the request reaches
  // a Next.js handler, the runtime has already accepted the host.
  const host = request.headers.get('host')
  if (host) {
    set.add(`https://${host}`)
    set.add(`http://${host}`)
  }
  return set
}

export function verifyOrigin(request: Request): NextResponse | null {
  const allowed = allowedOrigins(request)
  const origin = request.headers.get('origin')
  if (origin) {
    return allowed.has(origin)
      ? null
      : NextResponse.json({ error: 'Bad origin' }, { status: 403 })
  }
  // Some browsers (older/embedded) omit Origin on same-origin POSTs. Fall
  // back to Referer in that case.
  const referer = request.headers.get('referer')
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin
      return allowed.has(refOrigin)
        ? null
        : NextResponse.json({ error: 'Bad referer' }, { status: 403 })
    } catch {
      return NextResponse.json({ error: 'Bad referer' }, { status: 403 })
    }
  }
  // No Origin and no Referer: refuse. State-changing requests from a real
  // browser always carry one of them.
  return NextResponse.json({ error: 'Missing origin/referer' }, { status: 403 })
}
