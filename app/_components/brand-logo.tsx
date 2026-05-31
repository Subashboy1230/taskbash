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
  return <img src="/logo-gmail.png" width={size} height={size} alt="Gmail" style={{ display: 'block', borderRadius: 3 }} />
}

function CalendarLogo({ size }: { size: number }) {
  return <img src="/logo-calendar.png" width={size} height={size} alt="Google Calendar" style={{ display: 'block', borderRadius: 3 }} />
}

function GranolaLogo({ size }: { size: number }) {
  return <img src="/logo-granola.png" width={size} height={size} alt="Granola" style={{ display: 'block', borderRadius: 5 }} />
}

function LinearLogo({ size }: { size: number }) {
  return <img src="/logo-linear.png" width={size} height={size} alt="Linear" style={{ display: 'block', borderRadius: 5 }} />
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
