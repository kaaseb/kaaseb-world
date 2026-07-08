import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

// In-process lock used to replace gotrue-js's default navigator.locks-based
// implementation. The default fires a "Lock X was released because another
// request stole it" runtime error in Next.js dev whenever React Strict Mode
// double-renders or two tabs share a session — those aren't real failures,
// just contention on a Web Lock. A simple queue per name serializes the
// requests without ever stealing them.
//
// Token refreshes are still safe: gotrue-js coalesces concurrent calls
// internally and the Supabase server treats double-refreshes as idempotent.
const locks = new Map<string, Promise<unknown>>()
function inMemoryLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const prev = locks.get(name) ?? Promise.resolve()
  const next = prev.catch(() => null).then(fn)
  locks.set(name, next)
  // Clear the slot once this turn finishes so the map doesn't grow forever.
  next.finally(() => { if (locks.get(name) === next) locks.delete(name) })
  return next
}

export function createClient() {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        lock: inMemoryLock,
      },
    }
  )
  return client
}
