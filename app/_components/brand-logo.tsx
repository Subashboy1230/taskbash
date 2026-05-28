// Real brand logos for the sources we pull from. Used in both
// /connections (large) and /today's per-row SourceIcon (small).
//
// All SVGs are inline so they ship with the bundle (no network), are
// theme-friendly, and can be sized via the `size` prop.

import type { Source } from '@/lib/types'

type Brand =
  | 'gmail'
  | 'calendar'
  | 'granola'
  | 'linear'
  | 'slack'
  | 'manual'

function GmailLogo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M2 6.5a2.5 2.5 0 0 1 4-2L12 9l6-4.5a2.5 2.5 0 0 1 4 2v11A2.5 2.5 0 0 1 19.5 20H17V11.6l-5 3.75-5-3.75V20H4.5A2.5 2.5 0 0 1 2 17.5v-11Z"
        fill="#EA4335"
      />
      <path d="M4 20h3V11.6L4 9.35V17.5A2.5 2.5 0 0 0 6.5 20H4Z" fill="#4285F4" />
      <path d="M17 20h2.5a2.5 2.5 0 0 0 2.5-2.5V9.35L17 11.6V20Z" fill="#34A853" />
      <path d="M17 4.5 12 9 7 4.5l5 3.75 5-3.75Z" fill="#C5221F" />
      <path
        d="M7 11.6V20H4.5A2.5 2.5 0 0 1 2 17.5V6.55l5 5.05Z"
        fill="#4285F4"
        opacity=".0"
      />
    </svg>
  )
}

function CalendarLogo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2.5" fill="#fff" stroke="#DADCE0" strokeWidth="1.2" />
      <rect x="3" y="4" width="18" height="4.5" rx="2.5" fill="#fff" />
      <path d="M7 2v4M17 2v4" stroke="#5F6368" strokeWidth="1.6" strokeLinecap="round" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fontFamily="Roboto, system-ui, sans-serif"
        fill="#1A73E8"
      >
        28
      </text>
    </svg>
  )
}

function GranolaLogo({ size }: { size: number }) {
  // Granola's mark is a stylized G. We render the wordmark glyph in
  // their signature warm cream over deep ink.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#1A1614" />
      <path
        d="M16.5 11.4v4.1c-1.2.95-2.75 1.5-4.5 1.5-3.6 0-6.2-2.45-6.2-5.55s2.6-5.55 6.2-5.55c1.95 0 3.55.7 4.55 1.85l-1.95 1.95c-.6-.6-1.45-1-2.6-1-2 0-3.45 1.35-3.45 2.75s1.45 2.75 3.45 2.75c1.2 0 2.1-.4 2.7-.95v-.6h-2.55V11.4h4.35Z"
        fill="#F4E9D9"
      />
    </svg>
  )
}

function LinearLogo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="linearGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7B68EE" />
          <stop offset="1" stopColor="#5E6AD2" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="url(#linearGrad)" />
      <path
        d="M5.6 13.8c.45 2.5 2.4 4.45 4.9 4.9L5.6 13.8Zm-.1-3.05 7.95 7.95c.55-.05 1.1-.15 1.6-.3L5.5 9.15c-.15.5-.25 1.05-.3 1.6Zm.9-2.9 9.95 9.95c.4-.2.8-.45 1.15-.7L7.1 6.7c-.25.35-.5.75-.7 1.15Zm1.6-2.1c1.55-1.65 3.75-2.7 6.2-2.7a8.5 8.5 0 0 1 8.5 8.5c0 2.45-1.05 4.65-2.7 6.2L8 5.75Z"
        fill="#fff"
      />
    </svg>
  )
}

function SlackLogo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M6.5 14.5a1.6 1.6 0 1 1-1.6-1.6h1.6v1.6Zm.8 0a1.6 1.6 0 0 1 3.2 0v4a1.6 1.6 0 1 1-3.2 0v-4Z" fill="#E01E5A" />
      <path d="M9.5 6.5a1.6 1.6 0 1 1 1.6 1.6H9.5V6.5Zm0 .8a1.6 1.6 0 0 1 0 3.2h-4a1.6 1.6 0 1 1 0-3.2h4Z" fill="#36C5F0" />
      <path d="M17.5 9.5a1.6 1.6 0 1 1 1.6 1.6h-1.6V9.5Zm-.8 0a1.6 1.6 0 0 1-3.2 0v-4a1.6 1.6 0 1 1 3.2 0v4Z" fill="#2EB67D" />
      <path d="M14.5 17.5a1.6 1.6 0 1 1-1.6-1.6h1.6v1.6Zm0-.8a1.6 1.6 0 0 1 0-3.2h4a1.6 1.6 0 1 1 0 3.2h-4Z" fill="#ECB22E" />
    </svg>
  )
}

function ManualLogo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#F4F1EB" stroke="#E2DED4" strokeWidth="1" />
      <path
        d="M8 16v-2.2l5.4-5.4 2.2 2.2L10.2 16H8Zm6.5-6.5 1.4-1.4a1 1 0 0 1 1.4 0l.8.8a1 1 0 0 1 0 1.4l-1.4 1.4-2.2-2.2Z"
        fill="#8C8579"
      />
    </svg>
  )
}

const REGISTRY: Record<Brand, (props: { size: number }) => React.ReactElement> = {
  gmail: GmailLogo,
  calendar: CalendarLogo,
  granola: GranolaLogo,
  linear: LinearLogo,
  slack: SlackLogo,
  manual: ManualLogo,
}

/**
 * Render the brand logo for a connector source. Width/height defaults
 * to 20px. Pass `size` to override (used larger on /connections cards).
 */
export function BrandLogo({
  brand,
  size = 20,
}: {
  brand: Brand | Source
  size?: number
}) {
  const Component = REGISTRY[brand as Brand] ?? ManualLogo
  return <Component size={size} />
}
