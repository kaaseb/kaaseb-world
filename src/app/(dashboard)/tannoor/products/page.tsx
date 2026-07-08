import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { ProductsClient } from '@/components/tannoor/ProductsClient'
import type { TannoorProduct, FurnDepartment } from '@/types'

export const dynamic = 'force-dynamic'

export default async function TannoorProductsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.tannoor_products')) redirect('/dashboard')

  const [{ data: products }, { data: departments }] = await Promise.all([
    supabase.from('tannoor_products').select('*').order('created_at', { ascending: false }),
    supabase.from('furn_departments').select('*').eq('enabled', true).order('name_en'),
  ])

  return (
    <ProductsClient
      initialProducts={(products || []) as TannoorProduct[]}
      departments={(departments || []) as FurnDepartment[]}
      canManage={hasPermission(profile, permissions, 'tannoor.products.edit')}
    />
  )
}
