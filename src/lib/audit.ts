export async function logAudit(params: {
  user_id: string
  user_name: string | null
  user_email: string
  action_type: 'add' | 'edit' | 'delete'
  object_type: string
  object_name: string | null
  object_id?: string
}) {
  // Fire-and-forget via API route (uses admin client, bypasses RLS)
  fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {/* silent */})
}
