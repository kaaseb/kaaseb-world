import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  // Defense-in-depth: refuse to run in the browser. The service-role key must
  // never reach the client. Bundling this file into a client component would
  // throw at runtime and surface the leak immediately during testing.
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must only be called on the server')
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
