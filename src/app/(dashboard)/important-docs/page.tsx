import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ImportantDocsClient } from '@/components/important-docs/ImportantDocsClient'
import type { ImportantDocument } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ImportantDocsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.important_docs')) redirect('/dashboard')

  const { data: docs } = await supabase
    .from('important_documents')
    .select('*')
    .order('expiry_date', { ascending: true, nullsFirst: false })

  return (
    <ImportantDocsClient
      initialDocs={(docs || []) as ImportantDocument[]}
      canManage={hasPermission(profile, permissions, 'docs.important.manage')}
    />
  )
}
