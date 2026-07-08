// Raw diagnostic dump. No buttons, no fixes — just every relevant fact
// about the current request so the bug can be identified by looking at
// the screen instead of guessing.
//
// Lives outside the (dashboard) route group so it has zero dependency on
// profile lookup; it shows you whatever it can find, even if the layout
// would have crashed.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

async function readAdmin(table: string, filterCol: string, filterVal: string) {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from(table).select('*').eq(filterCol, filterVal)
    return { data, error: error?.message }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export default async function DiagnosePage() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Profile via USER-SCOPED client (what the app actually uses).
  const userScoped = await supabase
    .from('profiles').select('*').eq('id', user.id).maybeSingle()

  // Profile via SERVICE-ROLE client (bypasses RLS — the truth).
  const adminProfile = await readAdmin('profiles', 'id', user.id)

  // Also look up by email in case ids don't match.
  const profilesByEmail = user.email
    ? await readAdmin('profiles', 'email', user.email)
    : { data: null, error: null }

  // The exact Supabase URL this server is talking to.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '(missing)'
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY

  return (
    <div style={{
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      padding: 24, background: '#0b0e14', color: '#dadada',
      minHeight: '100vh', lineHeight: 1.7,
    }} dir="ltr">
      <h1 style={{ fontSize: 22, color: '#fff', marginBottom: 16 }}>Kaaseb diagnostic dump</h1>
      <p style={{ color: '#888', marginBottom: 24 }}>
        Take a screenshot of this page and send it back to identify the bug.
      </p>

      <Section title="Server config">
        <Row k="NEXT_PUBLIC_SUPABASE_URL" v={supabaseUrl} />
        <Row k="SUPABASE_SERVICE_ROLE_KEY" v={hasServiceKey ? '(set)' : '(MISSING)'} highlight={!hasServiceKey ? 'error' : 'good'} />
      </Section>

      <Section title="auth.getUser() — what the session says">
        <Row k="auth error" v={authErr?.message || '(none)'} />
        <Row k="user.id"    v={user.id} muted />
        <Row k="user.email" v={user.email || '(empty)'} />
      </Section>

      <Section title="profiles via USER-SCOPED client (RLS applies)">
        <Row k="error"           v={userScoped.error?.message || '(none)'} highlight={userScoped.error ? 'error' : undefined} />
        <Row k="row exists"      v={userScoped.data ? 'YES' : 'NO'} highlight={userScoped.data ? 'good' : 'error'} />
        {userScoped.data && (
          <>
            <Row k="profile.id"            v={userScoped.data.id} muted />
            <Row k="profile.email"         v={userScoped.data.email} />
            <Row k="profile.role"          v={String(userScoped.data.role)} highlight={userScoped.data.role === 'super_admin' ? 'good' : 'warn'} />
            <Row k="profile.custom_role"   v={String(userScoped.data.custom_role_id || '(null — good)')} />
            <Row k="ids match auth.id"     v={userScoped.data.id === user.id ? 'YES' : 'NO — MISMATCH'} highlight={userScoped.data.id === user.id ? 'good' : 'error'} />
          </>
        )}
      </Section>

      <Section title="profiles via SERVICE-ROLE client (truth — bypasses RLS)">
        <Row k="error"          v={adminProfile.error || '(none)'} highlight={adminProfile.error ? 'error' : undefined} />
        <Row k="rows by user.id" v={String(adminProfile.data?.length ?? 0)} />
        {(adminProfile.data || []).map((p, i: number) => (
          <div key={i} style={{ marginLeft: 16, marginTop: 8 }}>
            <Row k={`[${i}] id`}    v={String(p.id)} muted />
            <Row k={`[${i}] email`} v={String(p.email)} />
            <Row k={`[${i}] role`}  v={String(p.role)} highlight={p.role === 'super_admin' ? 'good' : 'warn'} />
          </div>
        ))}
      </Section>

      <Section title="profiles by email (catches id mismatches)">
        <Row k="rows by email" v={String(profilesByEmail.data?.length ?? 0)} />
        {(profilesByEmail.data || []).map((p, i: number) => (
          <div key={i} style={{ marginLeft: 16, marginTop: 8 }}>
            <Row k={`[${i}] profile.id`}      v={String(p.id)} muted />
            <Row k={`[${i}] matches user.id`} v={p.id === user.id ? 'YES' : 'NO'} highlight={p.id === user.id ? 'good' : 'error'} />
            <Row k={`[${i}] role`}            v={String(p.role)} />
          </div>
        ))}
      </Section>

      <div style={{
        marginTop: 24, padding: 12, background: '#1a1f2e',
        borderRadius: 8, fontSize: 12, color: '#888',
      }}>
        <strong style={{ color: '#fff' }}>How to read this:</strong>
        <ul style={{ marginTop: 8 }}>
          <li>If <code>profile.role = super_admin</code> in BOTH user-scoped AND service-role sections → the bug is browser/Next.js cache (sign out + Cmd-Shift-R).</li>
          <li>If <code>profile.role = employee</code> in service-role → SQL didn&apos;t run (or ran on a different project).</li>
          <li>If <code>ids match auth.id = NO</code> → the row exists but with a stale id; delete it and recreate.</li>
          <li>If <code>row exists = NO</code> → the SQL never inserted a row for this user.</li>
          <li>If <code>NEXT_PUBLIC_SUPABASE_URL</code> doesn&apos;t match where you ran SQL → wrong project.</li>
        </ul>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 24, padding: 16, background: '#11151c',
      borderRadius: 12, border: '1px solid #1f2937',
    }}>
      <h2 style={{ fontSize: 13, color: '#fff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.5 }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Row({
  k, v, muted, highlight,
}: {
  k: string
  v: string
  muted?: boolean
  highlight?: 'good' | 'warn' | 'error'
}) {
  const color = highlight === 'good'  ? '#34d399'
              : highlight === 'warn'  ? '#fbbf24'
              : highlight === 'error' ? '#f87171'
              : muted                  ? '#666'
              : '#dadada'
  const weight = highlight ? 700 : 400
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span style={{ color: '#888', minWidth: 220 }}>{k}:</span>
      <span style={{ color, fontWeight: weight, wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}
