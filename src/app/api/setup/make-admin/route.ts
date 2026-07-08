import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const admin = createAdminClient()

    // Check if any super_admin already exists (not counting this user)
    const { data: existingAdmins } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')
      .neq('id', user.id)
      .limit(1)

    // Only allow if no other super_admin exists (first user setup)
    if (existingAdmins && existingAdmins.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'A Super Admin already exists. Ask them to change your role.'
      }, { status: 403 })
    }

    // Make the current user super_admin
    const { error } = await admin
      .from('profiles')
      .update({ role: 'super_admin' })
      .eq('id', user.id)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
