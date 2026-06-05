// Root layout — required by Next.js App Router.

import type { Metadata } from 'next'
import { Toaster } from 'sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'taskbash',
  description: 'A personal chief-of-staff task manager.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: 'bg-surface border-line text-ink shadow-lg',
            },
          }}
        />
      </body>
    </html>
  )
}
