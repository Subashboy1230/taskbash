'use client'

// Login page — Google SSO only for now. Magic link can come later if
// needed. Lands here from the middleware redirect when an unauthenticated
// user tries to visit /today or /connections.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signInWithGoogle() {
    setError(null)
    setBusy(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // After Google redirects back to Supabase, Supabase sends the user
          // here. The route handler exchanges the code for a session, then
          // pushes them on to /today.
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      // signInWithOAuth navigates the window to Google; we won't usually
      // reach the next line, but keep busy=true just in case.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-6">
      <div className="w-full max-w-[400px] text-center">
        <h1 className="m-0 text-[34px] font-semibold tracking-tight text-ink">
          taskbash
        </h1>
        <p className="mt-2 text-[15px] text-ink-muted">
          Your morning digest, from every source.
        </p>

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-10 inline-flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-5 py-3 text-[15px] font-medium text-ink shadow-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          <GoogleMark />
          {busy ? 'Connecting to Google…' : 'Continue with Google'}
        </button>

        {error && (
          <p className="mt-4 text-[13px] text-danger-fg">{error}</p>
        )}

        <p className="mt-8 text-[12px] text-ink-faint">
          By signing in, you allow taskbash to read items from the sources
          you connect (Gmail, Calendar, Granola, Linear).
        </p>
      </div>
    </div>
  )
}

function GoogleMark() {
  // Standard 4-color G mark — inline SVG so we don't pull a dep.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.71H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}
