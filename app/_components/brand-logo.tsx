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
  // Gmail M-envelope: white bg, red top bar, blue left panel, green right panel, yellow envelope flaps
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect width="24" height="24" rx="3" fill="#fff" />
      {/* left blue panel */}
      <path d="M2 6.5v11A1.5 1.5 0 0 0 3.5 19H6V10.5L2 7.2V6.5Z" fill="#4285F4" />
      {/* right green panel */}
      <path d="M22 6.5v11a1.5 1.5 0 0 1-1.5 1.5H18V10.5l4-3.3V6.5Z" fill="#34A853" />
      {/* envelope body (white) */}
      <path d="M6 10.5V19h12V10.5L12 14.5 6 10.5Z" fill="#EA4335" />
      {/* M flaps */}
      <path d="M2 6.5C2 5.67 2.67 5 3.5 5h17c.83 0 1.5.67 1.5 1.5L12 14.5 2 6.5Z" fill="#EA4335" />
      <path d="M2 6.5 12 14.5l10-8L12 11 2 6.5Z" fill="#C5221F" />
    </svg>
  )
}

function CalendarLogo({ size }: { size: number }) {
  // Google Calendar 2020 icon: rounded square, blue header, white body with blue "31",
  // yellow top-right corner, green bottom-left corner, red bottom-right folded corner.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id="cal-clip"><rect width="24" height="24" rx="4" /></clipPath>
      </defs>
      <g clipPath="url(#cal-clip)">
        {/* white base */}
        <rect width="24" height="24" fill="#fff" />
        {/* blue top strip */}
        <rect width="24" height="9" fill="#4285F4" />
        {/* yellow top-right */}
        <rect x="15" y="0" width="9" height="9" fill="#FBBC04" />
        {/* green bottom-left */}
        <rect x="0" y="15" width="9" height="9" fill="#34A853" />
        {/* red bottom-right corner fold */}
        <path d="M24 19 L24 24 L19 24 Z" fill="#EA4335" />
        {/* white calendar body */}
        <rect x="2" y="9" width="20" height="13" fill="#fff" />
        {/* date */}
        <text x="12" y="19.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#1A73E8">31</text>
      </g>
    </svg>
  )
}

function GranolaLogo({ size }: { size: number }) {
  // Granola rebrand icon: lime/yellow-green background with a dark spiral mark
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect width="24" height="24" rx="5" fill="#B5C832" />
      {/* Spiral approximation using a path */}
      <path
        d="M12 4.5
           C16.5 4.5 19.5 7.5 19.5 12
           C19.5 16.5 16 19 12 19
           C8.5 19 6 16.5 6 13.5
           C6 10.5 8 8.5 10.5 8.5
           C12.5 8.5 14 9.8 14 11.5
           C14 13 13 14 11.5 14
           C10.5 14 10 13.5 10 12.5"
        fill="none"
        stroke="#1A1A1A"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LinearLogo({ size }: { size: number }) {
  // Linear icon: solid periwinkle/cornflower blue circle with 3 diagonal white stripes
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id="linear-clip"><circle cx="12" cy="12" r="10" /></clipPath>
      </defs>
      <circle cx="12" cy="12" r="10" fill="#7C83F7" />
      <g clipPath="url(#linear-clip)">
        {/* 3 diagonal white stripes, bottom-left to top-right like the actual logo */}
        <path d="M2 22 L22 2 L24 4 L4 24 Z" fill="#fff" opacity="0.9" />
        <path d="M2 17 L17 2 L19 4 L4 19 Z" fill="#fff" opacity="0.9" />
        <path d="M2 12 L12 2 L14 4 L4 14 Z" fill="#fff" opacity="0.9" />
      </g>
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
