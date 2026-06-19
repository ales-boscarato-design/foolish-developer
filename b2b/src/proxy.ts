import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const PUBLIC_PATHS = ['/login', '/auth/verify', '/api/auth/magic-link', '/api/auth/verify']
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)
const intlMiddleware = createMiddleware(routing)

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Run next-intl to detect locale and prepare response (sets NEXT_LOCALE cookie if needed)
  const intlResponse = intlMiddleware(req)

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

  return intlResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
