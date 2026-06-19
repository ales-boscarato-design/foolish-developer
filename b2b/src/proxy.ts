import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { routing } from './i18n/routing'

const PUBLIC_PATHS = ['/login', '/auth/verify', '/api/auth/magic-link', '/api/auth/verify']
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth check for protected paths
  if (!PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const token = req.cookies.get('b2b_session')?.value
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    try {
      await jwtVerify(token, SESSION_SECRET)
    } catch {
      const res = NextResponse.redirect(new URL('/login', req.url))
      res.cookies.delete('b2b_session')
      return res
    }
  }

  // Propagate locale from NEXT_LOCALE cookie to x-next-intl-locale header
  // so that next-intl's getRequestConfig can read it in server components.
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  const locale = (routing.locales as readonly string[]).includes(cookieLocale ?? '')
    ? cookieLocale!
    : routing.defaultLocale
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-next-intl-locale', locale)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
