// Outreach template text + placeholder filling.
//
// DEPENDENCY-FREE ON PURPOSE (same rule as lib/opportunities/types.ts): the send
// dialog imports this in the BROWSER to show the sender the exact final text
// before it leaves, and the server imports it too — so what you preview is
// literally what is mailed. Never import S3/SMTP here.

export const DEFAULT_SUBJECT =
  'Marble & Granite Supply — Capital Tower (Abraj Al-Asima) Company Profile'

export const DEFAULT_BODY = `Dear {{contact}},

I hope this message finds you well.

I am writing on behalf of Capital Tower – Abraj Al-Asima for Marble & Granite, a Riyadh-based supplier and installer of natural marble, granite, limestone and quartz for major projects across the Kingdom.

We have been following {{company}}'s work on {{project}}, and we believe our capabilities are a strong fit for your natural-stone scope.

Why clients work with us:
• ISO 9001:2015 certified quality management for natural marble, granite and stone
• Fully integrated process — quarry selection, cutting, surface processing, quality control and packing
• 35 machines and 10 vehicles supporting delivery schedules on large packages
• Materials compliant with sustainability standards, supporting LEED and Mostadam certified projects
• Trusted by Saudi Aramco, Red Sea Global, Riyadh Metro, KAFD, Ministry of Culture and Nesma United Industries

Our full company profile is attached for your review.

We would welcome the opportunity to be added to your approved supplier list, or to quote on any current or upcoming natural-stone package. We are glad to provide samples, technical submittals and pre-qualification documents on request.

Thank you for your time and consideration.

Best regards,
Capital Tower – Abraj Al-Asima for Marble & Granite
Kharj Road, Al-Manakh District, Riyadh, Saudi Arabia
+966 50 626 8080 | info@kaaseb.sa`

// Neutral stand-ins so a missing value never reads as a mail-merge failure to
// the customer ("Dear {{contact}}" is the classic embarrassment).
export const OUTREACH_FALLBACKS: Record<string, string> = {
  contact: 'Sir/Madam',
  company: 'your company',
  project: 'your upcoming projects',
  city: 'the Kingdom',
}

/** Fill {{placeholders}}; blanks fall back to a neutral phrase. */
export function renderOutreach(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => {
    const v = (vars[k] || '').trim()
    return v || OUTREACH_FALLBACKS[k] || ''
  })
}
