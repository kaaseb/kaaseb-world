import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createUnlockToken } from '@/lib/unlock-token'
import { verifyOrigin } from '@/lib/csrf'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const csrfError = verifyOrigin(request)
    if (csrfError) return csrfError

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // HMAC-signed token bound to this user, with a 1h expiry. The previous
    // base64(userId:timestamp) format was forgeable by anyone who knew a userId.
    const token = createUnlockToken(user.id)
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/unlock?token=${token}`

    // Send email using Supabase admin
    const adminSupabase = createAdminClient()

    // Use Supabase's built-in email
    const { error } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email!,
    })

    if (error) {
      // Fallback: log token for testing
      console.log('Reset URL:', resetUrl)
    }

    // Send custom email via fetch to Supabase's email endpoint
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          to: user.email,
          subject: 'Elzubair Dashboard - Unlock Reset',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="color: #1e293b; font-size: 24px; margin-bottom: 8px;">Reset Dashboard Lock</h1>
              <p style="color: #64748b; margin-bottom: 24px;">Click the button below to reset your dashboard lock. This link expires in 1 hour.</p>
              <a href="${resetUrl}" style="
                display: inline-block;
                background: #1e293b;
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 600;
                margin-bottom: 24px;
              ">Reset Lock Password</a>
              <p style="color: #94a3b8; font-size: 14px;">If you didn't request this, ignore this email.</p>
            </div>
          `,
        }),
      })
    } catch {
      console.log('Email send failed, reset URL:', resetUrl)
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
