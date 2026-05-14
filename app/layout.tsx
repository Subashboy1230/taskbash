// Root layout — required by Next.js App Router.
// Wraps every page. Keep it minimal for now; add fonts, providers later.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ToDoo — your morning digest',
  description: 'A personal chief-of-staff task manager.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
