import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { verifyOrigin } from '@/lib/csrf'

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    await supabase
      .from('profiles')
      .update({ lock_enabled: false, lock_password_hash: null })
      .eq('id', user.id)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
