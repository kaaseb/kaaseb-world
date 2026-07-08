'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

// Wraps next-themes so the rest of the tree can use `useTheme()`.
// `attribute="class"` makes next-themes toggle <html class="dark">, which the
// `@custom-variant dark (&:is(.dark *))` rule in globals.css depends on.
// Default is light; users opt into dark via the toggle. `enableSystem` is off
// so we never auto-pick dark from the OS preference.
// `disableTransitionOnChange` prevents the component-level CSS transitions
// from "running" the moment the theme flips; the html-level transition still
// gives a clean fade.
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      // Rotated storage key so users carrying an old `theme=dark` value in
      // localStorage from previous builds land on the new light default
      // instead of staying stuck on dark.
      storageKey="kaaseb-theme-v2"
      // Per-request CSP nonce so next-themes' inline theme-init script is
      // authorized by our strict Content-Security-Policy (otherwise the browser
      // blocks it and logs a CSP violation on every page load).
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}
