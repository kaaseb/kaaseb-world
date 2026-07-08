import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { PreQualDesigner } from '@/components/pre-qualifications/PreQualDesigner'
import type { ImportantDocument } from '@/types'

export const dynamic = 'force-dynamic'

export default async function NewPreQualPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'docs.prequal.manage')) redirect('/pre-qualifications')

  const { data: docs } = await supabase
    .from('important_documents').select('*').order('created_at', { ascending: false })

  return <PreQualDesigner availableDocs={(docs || []) as ImportantDocument[]} />
}
