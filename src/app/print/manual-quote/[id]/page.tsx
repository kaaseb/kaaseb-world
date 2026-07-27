import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { getManualQuote } from '@/lib/manual-quotes/store'
import { ManualQuotePrint } from '@/components/manual-quotes/ManualQuotePrint'

export const dynamic = 'force-dynamic'

export default async function ManualQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const quote = await getManualQuote(id)
  if (!quote) notFound()

  return <ManualQuotePrint quote={quote} />
}
