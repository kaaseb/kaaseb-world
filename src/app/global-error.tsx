'use client'

// Last-resort error boundary. Catches anything that escapes the root layout —
// including layout/template render failures — so Cloud Run never sees a raw
// unhandled exception (which would surface as a 500/502 to users).
//
// Must define its own <html> and <body> because it replaces the root layout
// entirely when triggered.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#f9fafb',
          color: '#111827',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
            حصل خطأ غير متوقع
          </h1>
          <p style={{ color: '#4b5563', marginBottom: 20, lineHeight: 1.7 }}>
            عذراً، النظام واجه مشكلة أثناء تحميل الصفحة. حاول مرة أخرى.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20 }}>
              معرف الخطأ: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: '#111827',
              color: 'white',
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  )
}
