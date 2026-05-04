import { NextRequest } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

const intlMiddleware = createNextIntlMiddleware(routing)

export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)
  const forwardedHost = headers.get('x-forwarded-host')
  if (forwardedHost && forwardedHost.includes(':')) {
    headers.set('x-forwarded-host', forwardedHost.split(':')[0])
  }
  headers.delete('x-forwarded-port')
  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo|images|fonts|.*\\..*).*)']
}
