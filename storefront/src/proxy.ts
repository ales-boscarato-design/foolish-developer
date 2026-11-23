import { NextRequest, NextResponse } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { legacyRedirectUrl } from './lib/legacy-slugs'

const intlMiddleware = createNextIntlMiddleware({
  ...routing,
  localeDetection: true,
})

export default function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)

  // Gli host come sono arrivati: la normalizzazione qui sotto toglie la porta dagli
  // header, e il dirottamento degli URL storici deve invece vedere i valori originali.
  const forwardedHostHeader = headers.get('x-forwarded-host')
  const hostHeader = headers.get('host')

  // Resolve legacy product URLs before the generic www redirect, which uses the
  // runtime origin and would otherwise preserve the malformed slug and scheme.
  const legacyRequestUrl = new URL(request.url)
  if (legacyRequestUrl.port === '8080') {
    legacyRequestUrl.port = ''
  }
  const legacyTarget = legacyRedirectUrl(legacyRequestUrl.pathname, {
    requestUrl: legacyRequestUrl,
    hosts: [hostHeader, forwardedHostHeader],
    forwardedProto: headers.get('x-forwarded-proto'),
  })
  if (legacyTarget) {
    const targetUrl = new URL(legacyTarget)
    // The legacy helper validates the request host; retain the site's existing
    // www → apex canonicalization without deriving the origin from request.url.
    if (targetUrl.hostname === 'www.thefoolishbutcher.com') {
      targetUrl.hostname = 'thefoolishbutcher.com'
    }
    return NextResponse.redirect(targetUrl.toString(), {
      status: 301,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

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
