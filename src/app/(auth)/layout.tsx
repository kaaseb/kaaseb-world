// Auth pages must be rendered per-request: the middleware injects a fresh CSP
// nonce on every response, and a statically prerendered HTML would ship with a
// stale nonce that the browser rejects under `strict-dynamic`, blocking every
// script on the page.
export const dynamic = 'force-dynamic'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
