import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('lock_password_hash')
      .eq('id', user.id)
      .single()

    if (!profile?.lock_password_hash) {
      return NextResponse.json({ success: false, error: 'No lock password set' }, { status: 400 })
    }

    const isValid = await bcrypt.compare(password, profile.lock_password_hash)

    return NextResponse.json({ success: isValid })
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
