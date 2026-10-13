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

  // Uno slug di prodotto malformato (contiene spazi) non e' recuperabile: la
  // richiesta arriva codificata e il CMS non trova mai la stringa, quindi la
  // pagina risponde 404. Si dirotta sul percorso canonico invece di lasciare un
  // 404 a chi stava comprando.
  //
  // L'URL assoluto e la scelta dell'host stanno in `lib/legacy-slugs.ts`, dove si
  // possono provare: qui resta la sola chiamata.
  const legacyTarget = legacyRedirectUrl(url.pathname, {
    requestUrl: url,
    // Il primo candidato utilizzabile vince: un `X-Forwarded-Host` scritto dal client
    // decide solo se l'host della richiesta non e' utilizzabile.
    hosts: [hostHeader, forwardedHostHeader],
    forwardedProto: headers.get('x-forwarded-proto'),
  })
  if (legacyTarget) {
    // `no-store`: il `Location` dipende da un header della richiesta, e un 301 e'
    // cacheabile anche senza indicazioni esplicite (RFC 9111 §4.2.2).
    return NextResponse.redirect(legacyTarget, { status: 301, headers: { 'Cache-Control': 'no-store' } })
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
