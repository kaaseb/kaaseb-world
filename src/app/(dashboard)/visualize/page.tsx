import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { VisualizeClient } from '@/components/visualize/VisualizeClient'
import { getProductImages } from '@/lib/tannoor/product-images'
import { topProductIds } from '@/lib/visualize/product-usage'

export const dynamic = 'force-dynamic'

export default async function VisualizePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.visualize')) redirect('/dashboard')

  // Only select columns that exist on the table (color_en/ar + finish live in
  // the S3 extras store, not the DB — selecting them errors out the query).
  const { data: products } = await supabase
    .from('tannoor_products')
    .select('id, name_en, name_ar')
    .order('name_en', { ascending: true })

  const [images, topIds] = await Promise.all([
    getProductImages(),
    topProductIds(5),
  ])

  const isSuperAdmin = profile.role === 'super_admin'

  return <VisualizeClient products={products || []} images={images} topProductIds={topIds} isSuperAdmin={isSuperAdmin} />
}
