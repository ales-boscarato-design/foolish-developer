import { NextRequest, NextResponse } from 'next/server'
import createNextIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { canonicalLegacyPath } from './lib/legacy-slugs'

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

  // Uno slug di prodotto malformato (contiene spazi) non e' recuperabile: la
  // richiesta arriva codificata e il CMS non trova mai la stringa, quindi la
  // pagina risponde 404. Si dirotta sul percorso canonico invece di lasciare un
  // 404 a chi stava comprando.
  //
  // Il runtime del middleware pretende un `Location` assoluto, quindi l'origine si
  // costruisce sull'host pubblico gia' normalizzato qui sopra: derivarla dall'URL
  // interno della richiesta farebbe uscire l'indirizzo del container dietro il
  // proxy di Railway.
  const legacyPath = canonicalLegacyPath(url.pathname)
  if (legacyPath) {
    const protocol = headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    const origin = `${protocol}://${cleanHost || url.host}`
    return NextResponse.redirect(new URL(legacyPath, origin), { status: 301 })
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
