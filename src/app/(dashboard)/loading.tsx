// Streamed loading UI. Triggers Next.js to flush headers + this fallback to
// the client immediately while the server component awaits its Supabase
// queries. Without this, the upstream proxy (Cloud Run/LB) sees no bytes
// for several seconds on slow queries and returns 502 Bad Gateway.
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900"
        aria-label="جارٍ التحميل"
      />
    </div>
  )
}
