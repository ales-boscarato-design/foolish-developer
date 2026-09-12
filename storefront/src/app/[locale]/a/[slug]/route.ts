import { NextRequest, NextResponse } from 'next/server'
import { routing } from '@/i18n/routing'
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
 */
function noStoreRedirect(url: URL): NextResponse {
  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Robots-Tag', 'noindex')
  return response
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
  const safeLocale = routing.locales.includes(locale as (typeof routing.locales)[number])
    ? locale
    : routing.defaultLocale
  const home = new URL(`/${safeLocale}`, req.url)

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
  // "/<tab>/evil.com" into an external protocol-relative URL.
  const target = safeRedirectTarget(req.nextUrl.searchParams.get('to'), req.url)
  const response = noStoreRedirect(new URL(target ?? `/${safeLocale}`, req.url))

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
