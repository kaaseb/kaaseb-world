import type { NextConfig } from "next";

// HTTP response headers applied to every route.
// Notes:
// - HSTS is only set in production. Setting it in dev would force HTTPS on
//   localhost in browsers that already cached it, which breaks `next dev`.
// - Content-Security-Policy is set per-request from `src/lib/supabase/middleware.ts`
//   so each response can carry a unique nonce that authorizes Next.js's inline
//   scripts. Setting CSP here would override the per-request nonce header.
const securityHeaders = [
  // Prevent the page from being framed by other origins (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop the browser from MIME-sniffing a response away from its declared type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak the full URL on cross-origin navigations.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Lock down browser features we never use. Add entries when you opt in.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Block legacy XSS auditor's "block" mode (which had its own bugs).
  { key: 'X-XSS-Protection', value: '0' },
  // Belt-and-suspenders pair for cross-origin isolation.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  })
}

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Skip type checking & linting during build (already done in dev)
  typescript: {
    ignoreBuildErrors: false,
  },
  // Compress output
  compress: true,
  // Hide the framework version (small recon win for attackers).
  poweredByHeader: false,
  experimental: {
    // When proxy.ts is present, Next.js 16 buffers the request body in
    // memory so both the proxy and the route handler can read it. The
    // default cap is 10 MB; anything larger arrives at the route truncated,
    // which surfaces as "Failed to parse body as FormData" for multipart
    // uploads. We host this app behind our own infra and explicitly do NOT
    // want Next.js policing body size — bumped to 100 GB so even very
    // large BOQs / drawings / archives go through unchanged. (Next.js's
    // parser doesn't accept "unlimited"; a number this large is effectively
    // the same in practice.) If you ever need bigger, raise this value
    // here — the upload route imposes no app-level cap of its own.
    proxyClientMaxBodySize: '100gb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
