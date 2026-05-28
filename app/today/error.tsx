'use client'

// Error boundary for /today. Catches anything thrown during render so the
// Next dev runtime doesn't fall into the "missing required error
// components" state, and surfaces the message + a Try-again button.

import { useEffect } from 'react'

export default function TodayError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[/today] render error:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-[700px] px-8 pt-16">
      <h1 className="text-[20px] font-semibold text-ink">
        Something broke rendering /today.
      </h1>
      <pre className="mt-3 overflow-auto rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-danger-fg whitespace-pre-wrap">
        {error.message}
        {error.stack ? `\n\n${error.stack}` : ''}
      </pre>
      <button
        onClick={reset}
        className="mt-3 rounded-md bg-success-fg px-3 py-1.5 text-[13px] font-semibold text-white hover:opacity-90"
      >
        Try again
      </button>
    </div>
  )
}
