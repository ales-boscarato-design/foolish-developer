import { NextRequest, NextResponse } from 'next/server'
import { routing } from '@/i18n/routing'
import { preferredLocale } from '@/lib/accept-language'
import {
  AFFILIATE_REFERRAL_COOKIE,
  normalizeAffiliateSlug,
  referralCookieMaxAgeSeconds,
  resolveAffiliateBySlug,
  safeRedirectTarget,
} from '@/lib/affiliate-referral'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ locale: string; slug: string }> }

/**
 * Every response of this route is uncacheable and unindexable: the success
 * branch carries the referral cookie, and the fallback branches must not be
 * cached either, or a stale redirect would outlive the referral.
 *
 * The Location is always a relative path. Deriving an absolute URL from the
 * request emits whatever origin the runtime sees, which behind a proxy is the
 * internal bind address (https://0.0.0.0:8080/it) and not the public host: the
 * visitor would be sent to a dead address. A relative Location is resolved by
 * the browser against the host it already asked for, so it is correct on every
 * deployment and adds no redirect surface.
 */
function noStoreRedirect(location: string): NextResponse {
  const response = new NextResponse(null, { status: 302, headers: { Location: location } })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Robots-Tag', 'noindex')
  return response
}


/**
 * Adds the visible referral markers to the landing path.
 *
 * The commission is decided by the cookie, which never appears in the URL: that
 * is invisible to whoever checks the link, to analytics, and to Alessandro
 * reading the traffic. These parameters make the referral legible — `ref` names
 * the affiliate, the `utm_*` trio lands in the analytics — without becoming a
 * second source of truth for money. They are added to the query, before any
 * fragment, and merged with a query the target already carries.
 */
function withAttribution(path: string, slug: string): string {
  const hashIndex = path.indexOf('#')
  const beforeHash = hashIndex === -1 ? path : path.slice(0, hashIndex)
  const fragment = hashIndex === -1 ? '' : path.slice(hashIndex)
  const separator = beforeHash.includes('?') ? '&' : '?'
  const markers = new URLSearchParams({
    ref: slug,
    utm_source: 'affiliate',
    utm_medium: 'referral',
    utm_campaign: slug,
  })
  return `${beforeHash}${separator}${markers.toString()}${fragment}`
}

/**
 * Affiliate referral link: /<locale>/a/<slug>
 *
 * Stores the affiliate slug in a first-party cookie and sends the visitor to the
 * shop. The cookie is only written when the slug resolves to an active affiliate
 * in the CMS, so an unknown or malformed link never creates a referral.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const { locale, slug } = await context.params
  const requestedLocale = routing.locales.includes(locale as (typeof routing.locales)[number])
    ? locale
    : routing.defaultLocale
  // A language-specific link (/es/a/nestor) keeps the language it was shared
  // with: that choice was deliberate. A link on the default locale is the
  // neutral one, so it localises to the visitor's browser language — the same
  // thing the shop's own root does — and a Spanish visitor stops landing on the
  // Italian home. The referral cookie is path-wide, so the discount is
  // unaffected by the language the visitor ends up on.
  const visitorLocale = preferredLocale(req.headers.get('accept-language'), routing.locales)
  const safeLocale = requestedLocale === routing.defaultLocale
    ? visitorLocale ?? requestedLocale
    : requestedLocale
  const home = `/${safeLocale}`

  const normalizedSlug = normalizeAffiliateSlug(slug)
  if (normalizedSlug === null) {
    return noStoreRedirect(home)
  }

  const affiliate = await resolveAffiliateBySlug(normalizedSlug)
  if (!affiliate) {
    return noStoreRedirect(home)
  }

  // `?to=` is resolved and origin-checked in the lib: a prefix test on the raw
  // string is not enough, because the URL parser strips tab/CR/LF and turns
  // "/<tab>/evil.com" into an external protocol-relative URL. Only the path it
  // returns is used, so the emitted Location stays relative.
  const target = safeRedirectTarget(req.nextUrl.searchParams.get('to'), req.url)
  const response = noStoreRedirect(withAttribution(target ?? home, affiliate.slug))

  const maxAge = referralCookieMaxAgeSeconds(affiliate.cookieWindowDays)
  if (maxAge !== null) {
    // The referral cookie decides discounts and commission, so it must never
    // travel in clear. Rely on an explicit HTTPS signal as well as NODE_ENV,
    // because a deployment that forgets NODE_ENV=production would otherwise
    // downgrade it to an insecure cookie.
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? ''
    const isHttps = req.nextUrl.protocol === 'https:'
      || forwardedProto.split(',')[0].trim() === 'https'
    response.cookies.set(AFFILIATE_REFERRAL_COOKIE, affiliate.slug, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' || isHttps,
      path: '/',
      maxAge,
    })
  }
  return response
}
