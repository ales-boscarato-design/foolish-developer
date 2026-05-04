import { NextRequest } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

const intlMiddleware = createNextIntlMiddleware(routing)

export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)

  const forwardedHost = headers.get('x-forwarded-host')
  if (forwardedHost) {
    if (forwardedHost.includes(':')) {
      headers.set('x-forwarded-host', forwardedHost.split(':')[0])
    }
  } else {
    headers.set('x-forwarded-host', request.headers.get('host')?.split(':')[0] ?? '')
  }

  if (!headers.get('x-forwarded-port')) {
    headers.set('x-forwarded-port', '443')
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo|images|fonts|.*\\..*).*)']
}
