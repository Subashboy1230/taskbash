'use client'

// Login page — Google SSO + Granola-branded entry (both use Google OAuth).
// Lands here from the middleware redirect when an unauthenticated user tries
// to visit /today or /connections.

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

type Provider = 'google' | 'granola'

export default function LoginPage() {
  const [busy, setBusy] = useState<Provider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function signIn(provider: Provider) {
    setError(null)
    setBusy(provider)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
      setBusy(null)
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

        <div className="mt-10 flex flex-col gap-3">
          <button
            onClick={() => signIn('google')}
            disabled={!!busy}
            className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-5 py-3 text-[15px] font-medium text-ink shadow-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            <GoogleMark />
            {busy === 'google' ? 'Connecting…' : 'Continue with Google'}
          </button>

          <button
            onClick={() => signIn('granola')}
            disabled={!!busy}
            className="inline-flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-5 py-3 text-[15px] font-medium text-ink shadow-sm transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-granola.png" width={18} height={18} alt="Granola" style={{ borderRadius: 4 }} />
            {busy === 'granola' ? 'Connecting…' : 'Continue with Granola'}
          </button>
        </div>

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
