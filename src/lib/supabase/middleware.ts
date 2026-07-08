import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes } from 'crypto'

// Build a strict Content-Security-Policy with a per-request nonce. The nonce
// authorizes Next.js's runtime/inline scripts; everything not signed by the
// nonce or loaded from 'self' is rejected, which closes the door on injected
// <script src="evil.com"> payloads even if XSS slips through.
//
// Notes on each directive:
//   • script-src: 'strict-dynamic' lets nonce-bound scripts load further
//     scripts at runtime (Next.js's chunking does this). Without it the page
//     wouldn't hydrate.
//   • style-src 'unsafe-inline': Tailwind, sonner, and Base UI inject inline
//     <style> blocks and styles. Hardening this further requires a separate
//     style-nonce setup — tracked as follow-up.
//   • connect-src: Supabase realtime uses wss://. We allow the project's host
//     and the realtime upgrade.
//   • frame-ancestors 'none' / X-Frame-Options DENY: redundant with the
//     header in next.config.ts but kept here so the rule lives next to the
//     rest of the policy.
function buildCsp(nonce: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  let supabaseHost = ''
  if (supabaseUrl) {
    try { supabaseHost = new URL(supabaseUrl).host } catch { /* ignore */ }
  }
  const supabaseConnect = supabaseHost
    ? `https://${supabaseHost} wss://${supabaseHost}`
    : 'https://*.supabase.co wss://*.supabase.co'

  // React dev-mode emits eval() for things like callstack reconstruction and
  // hot-reload internals. Allow it ONLY in development; never in production
  // (eval is a major XSS escalation surface).
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`

  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabaseConnect}`,
    `media-src 'self' https:`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join('; ')
}

export async function updateSession(request: NextRequest) {
  // Per-request nonce. 16 bytes ≈ 128 bits of entropy, base64-encoded for the
  // CSP header.
  const nonce = randomBytes(16).toString('base64')

  // Forward the nonce as a request header so Server Components can read it via
  // `headers()` if they need to attach `nonce={nonce}` to their own scripts.
  // Next.js's built-in scripts auto-pick up the nonce when it's set this way.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Bound the auth check so a slow/flaky Supabase call can't hang the entire
  // middleware and surface as a 502 Bad Gateway from the upstream proxy.
  // If the call fails or times out we skip the auth-based redirect and let
  // the request through; the downstream page will redo `getUser()` and
  // handle auth itself, so a flaky network blip doesn't bounce live sessions
  // to /login.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  let authChecked = false
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('supabase auth timeout')), 3000)
      ),
    ])
    user = result.data.user
    authChecked = true
  } catch (err) {
    console.error('[proxy] supabase.auth.getUser failed:', err)
  }

  const { pathname } = request.nextUrl

  // Public routes
  const publicRoutes = ['/login', '/signup', '/auth/callback', '/auth/reset-password', '/auth/unlock']
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  if (authChecked && !user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Apply CSP to the final response. Use Report-Only via env flag while
  // tuning a new policy in production; flip back to enforcement once you've
  // confirmed nothing legitimate is being blocked.
  const csp = buildCsp(nonce)
  const headerName = process.env.CSP_REPORT_ONLY === '1'
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy'
  supabaseResponse.headers.set(headerName, csp)
  // Echo the nonce so client-side debugging tools can see what's expected.
  supabaseResponse.headers.set('x-nonce', nonce)

  return supabaseResponse
}
