import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ImportantDocsClient } from '@/components/important-docs/ImportantDocsClient'
import { ImportantDocsLock } from '@/components/important-docs/ImportantDocsLock'
import { docsUnlocked, docsLockConfigured } from '@/lib/docs/lock'
import type { ImportantDocument } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ImportantDocsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.important_docs')) redirect('/dashboard')

  const isSuperAdmin = profile.role === 'super_admin'

  // Optional secret gate (off until the super admin sets a PIN). Once set, even
  // authorised users must unlock before any document is loaded.
  if (!(await docsUnlocked())) return <ImportantDocsLock />

  const [{ data: docs }, lockOn] = await Promise.all([
    supabase
      .from('important_documents')
      .select('*')
      .order('expiry_date', { ascending: true, nullsFirst: false }),
    docsLockConfigured(),
  ])

  return (
    <ImportantDocsClient
      initialDocs={(docs || []) as ImportantDocument[]}
      canManage={hasPermission(profile, permissions, 'docs.important.manage')}
      isSuperAdmin={isSuperAdmin}
      lockConfigured={lockOn}
    />
  )
}
