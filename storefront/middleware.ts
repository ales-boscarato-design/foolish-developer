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
  const url = new URL(request.url)
  url.port = ''
  const cleanReq = new NextRequest(url.toString(), {
    method: request.method,
    headers,
    body: request.body,
  })
  return intlMiddleware(cleanReq)
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo|images|fonts|.*\\..*).*)']
}
