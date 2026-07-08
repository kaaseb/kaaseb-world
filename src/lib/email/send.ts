import { getTransport, getFromAddress } from './client'

interface SendArgs {
  to: string | string[]
  subject: string
  html: string
  text?: string
  // Optional reply-to so users replying to a notification land somewhere
  // sensible instead of the noreply mailbox.
  replyTo?: string
}

// Send an email. Errors are caught and logged — the caller (usually a
// background trigger fired after a user action) shouldn't fail the user's
// request just because email delivery hiccuped. Returns a boolean for
// observability when the caller cares.
export async function sendEmail(args: SendArgs): Promise<boolean> {
  try {
    const transport = getTransport()
    await transport.sendMail({
      from: getFromAddress(),
      to: Array.isArray(args.to) ? args.to.join(', ') : args.to,
      subject: args.subject,
      html: args.html,
      text: args.text ?? stripHtml(args.html),
      replyTo: args.replyTo,
    })
    return true
  } catch (err) {
    console.error('[email] send failed:', err)
    return false
  }
}

// Crude HTML → text fallback for clients that don't render HTML.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
