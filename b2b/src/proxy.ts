import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { routing } from './i18n/routing'

// 2026-07-29 — carrello e checkout aperti agli ospiti.
//
// Prima l'auth copriva anche /carrello e /checkout, e il risultato era
// un portale chiuso a chi voleva comprare ma aperto a chiunque: la
// registrazione concede `active` all'istante a chiunque digiti una
// ragione sociale qualsiasi, e la partita IVA raccolta al checkout non
// veniva verificata da nessuno. Il muro non filtrava niente, fermava
// soltanto il primo ordine di un rivenditore nuovo — cioè esattamente
// la persona che l'email a freddo manda sul portale.
//
// Il carrello poi non aveva nemmeno bisogno di quel gate: è uno store
// zustand persistito in localStorage, vive solo nel browser.
//
// L'identità ora si chiede dove serve — al checkout, insieme
// all'indirizzo di fatturazione — e si verifica davvero, contro il
// VIES (vedi src/lib/vies.ts). /account resta protetto: lì si guarda
// lo storico ordini, e serve essere qualcuno.
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/catalogo',
  '/api/catalog',
  '/carrello',
  '/checkout',
  '/api/checkout',
  '/api/vat',
  '/api/stripe',
]
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth check for protected paths
  if (pathname !== '/' && !PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
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

  // Propagate locale from NEXT_LOCALE cookie to x-next-intl-locale header
  // so that next-intl's getRequestConfig can read it in server components.
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  const locale = (routing.locales as readonly string[]).includes(cookieLocale ?? '')
    ? cookieLocale!
    : routing.defaultLocale
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-next-intl-locale', locale)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
