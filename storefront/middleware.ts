import { NextRequest } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

const intlMiddleware = createNextIntlMiddleware(routing)

export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)
  const forwardedHost = headers.get('x-forwarded-host')
  if (forwardedHost && forwardedHost.includes(':')) {
    const [hostname] = forwardedHost.split(':')
    headers.set('x-forwarded-host', hostname)
  }
  const cleanRequest = new NextRequest(request.url, {
    method: request.method,
    headers,
    body: request.body,
  })
  return intlMiddleware(cleanRequest)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo|images|fonts|.*\\..*).*)']
}
