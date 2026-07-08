import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const admin = createAdminClient()

    // Check if profiles table exists
    const { error: tableError } = await admin.from('profiles').select('id').limit(1)

    if (tableError) {
      return NextResponse.json({
        dbReady: false,
        error: 'Database tables not found. Please run the schema SQL in Supabase.'
      })
    }

    // Check if any super_admin exists
    const { data: admins } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)

    return NextResponse.json({
      dbReady: true,
      hasSuperAdmin: (admins?.length || 0) > 0
    })
  } catch (e) {
    return NextResponse.json({ dbReady: false, error: String(e) })
  }
}
