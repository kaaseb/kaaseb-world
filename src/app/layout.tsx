import type { Metadata, Viewport } from 'next'
import { Tajawal } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { Toaster } from 'sonner'
import NextTopLoader from 'nextjs-toploader'
import { ThemeProvider } from '@/components/providers/ThemeProvider'

const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['200', '300', '400', '500', '700', '800', '900'],
  variable: '--font-tajawal',
  // Display swap so text appears immediately on slow networks instead of
  // blocking on the font download — critical for mobile LCP.
  display: 'swap',
})

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://world.kaaseb.sa'

// Native-feel viewport: viewport-fit cover paints the page edge-to-edge
// under the notch / dynamic island; safe-area-inset-* handles the padding.
// userScalable true keeps accessibility (pinch-zoom for low-vision users).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#39540b' },
    { media: '(prefers-color-scheme: dark)',  color: '#0c1426' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Kaaseb | كاسب',
  description: 'Kaaseb — Marble & Granite quotation platform',
  icons: { icon: '/kaaseb-logo.png', apple: '/kaaseb-logo.png' },
  applicationName: 'Kaaseb',
  appleWebApp: {
    capable: true,
    title: 'Kaaseb',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: 'Kaaseb | كاسب',
    description: 'Marble & Granite quotation platform',
    url: SITE_URL,
    siteName: 'Kaaseb',
    locale: 'ar_SA',
    type: 'website',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The middleware sets a per-request CSP nonce on the `x-nonce` request header.
  // Forward it to next-themes so its inline theme-init script is authorized.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preload the logo so the mobile top bar / sidebar header paints
            without waiting for the HTML parser to discover the <img>. */}
        <link rel="preload" as="image" href="/kaaseb-logo.png" fetchPriority="high" />
      </head>
      <body className={`${tajawal.variable} font-tajawal`} suppressHydrationWarning>
        <ThemeProvider nonce={nonce}>
          <NextTopLoader color="var(--primary)" showSpinner={false} height={2} />
          {children}
          <Toaster position="top-right" richColors theme="light" />
        </ThemeProvider>
      </body>
    </html>
  )
}
