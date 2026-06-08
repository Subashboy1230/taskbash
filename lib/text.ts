// Small text helpers used at render time on the client.

/**
 * Decode the handful of HTML entities that show up in email body previews
 * after they've been through Gmail's quoted-printable + HTML encoding.
 * We get text like "Here&#39;s my calendar" from Gmail draft bodies and
 * render it directly as text content; without this decode the user sees
 * the raw `&#39;` instead of the apostrophe.
 *
 * This is intentionally a tiny string-replace (not DOMParser) so it works
 * on both server and client, and so a malformed entity doesn't blow up.
 */
export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // &amp; MUST be last so we do not double-decode things like &amp;lt;
    .replace(/&amp;/g, '&')
}
