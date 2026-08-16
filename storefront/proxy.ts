import { NextRequest, NextResponse } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './src/i18n/routing'

const intlMiddleware = createNextIntlMiddleware({
  ...routing,
  localeDetection: true,
})

export default function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)

  // Redirect www → apex domain (canonical URL)
  const rawHost = headers.get('host') || headers.get('x-forwarded-host') || ''
  const cleanHost = rawHost.split(':')[0]
  if (cleanHost === 'www.thefoolishbutcher.com') {
    const url = new URL(request.url)
    url.hostname = 'thefoolishbutcher.com'
    url.port = ''
    return NextResponse.redirect(url.toString(), { status: 301 })
  }

  if (rawHost.includes(':')) {
    headers.set('host', cleanHost)
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
  matcher: ['/((?!api|ordine|account|_next/static|_next/image|favicon.ico|logo|images|fonts|.*\\..*).*)'],
}
