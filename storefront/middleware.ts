import { NextRequest } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

const intlMiddleware = createNextIntlMiddleware(routing)

export default function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)

  const host = headers.get('host') || ''
  if (host.includes(':')) {
    headers.set('host', host.split(':')[0])
  }

  const forwardedHost = headers.get('x-forwarded-host')
  if (forwardedHost && forwardedHost.includes(':')) {
    headers.set('x-forwarded-host', forwardedHost.split(':')[0])
  }

  headers.delete('x-forwarded-port')

  const url = new URL(request.url)
  if (url.port === '8080') {
    url.port = ''
  }

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
