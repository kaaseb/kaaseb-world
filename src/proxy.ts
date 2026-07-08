import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Skip the proxy for /api/upload — when proxy.ts runs, Next.js 16
    // clones and buffers the request body so it can be read in both
    // places. Multipart uploads then arrive at the route handler as a
    // re-emitted stream, which Turbopack/dev mode occasionally truncates
    // and breaks `request.formData()`. The upload route does its own
    // auth check via supabase.auth.getUser(), so the session-refresh
    // proxy isn't needed there.
    '/((?!_next/static|_next/image|favicon.ico|api/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
