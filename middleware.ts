// Route protection middleware. Runs on every request EXCEPT static assets
// and the auth/login paths. If there's no Supabase session cookie, redirect
// to /login. Also keeps the session cookie fresh on every navigation by
// using @supabase/ssr's createServerClient.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import * as Sentry from '@sentry/nextjs'

export async function middleware(request: NextRequest) {
  // Build a response we can attach refreshed cookies to.
  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Touch the session — refreshes the cookie if it's near expiry.
  // A throw here (e.g. Supabase network failure) would otherwise be invisible,
  // so capture it and treat the request as unauthenticated.
  let user = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (err) {
    Sentry.captureException(err)
    await Sentry.flush(2000)
  }

  const path = request.nextUrl.pathname
  const isPublic =
    path === '/' ||
    path.startsWith('/home') || // Marketing landing page — viewable by anyone
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    path.startsWith('/privacy') ||
    path.startsWith('/terms') ||
    path.startsWith('/api/inngest') || // Inngest webhook — never gated
    path.startsWith('/api/whatsapp/webhook') // Twilio webhook — verified by signature

  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  // Signed-in user landing on / or /login → push them to /today.
  if (user && (path === '/' || path === '/login')) {
    return NextResponse.redirect(new URL('/today', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Run on every path except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
