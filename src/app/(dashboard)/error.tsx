'use client'

import { useEffect } from 'react'

// Catches uncaught errors thrown by any dashboard page/layout. Without this,
// a single failed Supabase query (network blip, RLS hiccup) propagates to
// Cloud Run as a 500 instead of a recoverable in-app error state.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard] render error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="mb-3 text-2xl font-bold text-gray-900">
        تعذّر تحميل هذه الصفحة
      </h2>
      <p className="mb-6 max-w-md text-sm leading-relaxed text-gray-600">
        قد تكون هناك مشكلة مؤقتة في الاتصال بقاعدة البيانات. حاول التحديث.
      </p>
      {error.digest && (
        <p className="mb-4 text-xs text-gray-400">معرف الخطأ: {error.digest}</p>
      )}
      <button
        onClick={() => reset()}
        className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
      >
        إعادة المحاولة
      </button>
    </div>
  )
}
