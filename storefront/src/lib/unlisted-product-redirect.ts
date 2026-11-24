const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
// Product source slugs follow Products.slug (no consecutive/edge hyphens) and
// have no max length; only supersededBy is capped at 63 characters.
const SOURCE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOCALES = new Set(['it', 'en', 'de', 'fr', 'es'])
const STOREFRONT_ORIGIN = 'https://thefoolishbutcher.com'

// Kept shared with next.config.ts so CMS redirects cannot enter a Next redirect loop.
export const MASTER_PACK_REDIRECT = {
  source: 'master-pack-20-fogli',
  destination: 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl',
} as const

function historicalRedirectDestination(slug: string): string | null {
  return slug === MASTER_PACK_REDIRECT.source ? MASTER_PACK_REDIRECT.destination : null
}

type CmsProduct = { unlisted?: unknown; supersededBy?: unknown }
export type UnlistedProductResolution = { status: 'redirect'; location: string; statusCode?: 301 | 308 } | { status: 'not-found' } | { status: 'unavailable' } | null

async function getBySlug(slug: string): Promise<CmsProduct | null> {
  const query = new URLSearchParams({ 'where[slug][equals]': slug, depth: '0', limit: '1' })
  const response = await fetch(`${CMS_URL}/api/products?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`CMS product lookup failed: ${response.status}`)
  const body = await response.json() as { docs?: unknown }
  if (!Array.isArray(body.docs)) throw new Error('CMS product lookup returned invalid docs')
  if (!body.docs[0]) return null
  if (typeof body.docs[0] !== 'object') throw new Error('CMS product lookup returned an invalid product')
  return body.docs[0] as CmsProduct
}

export async function unlistedProductRedirect(pathname: string): Promise<UnlistedProductResolution> {
  const match = pathname.match(/^\/([a-z]{2})\/prodotto\/([^/]+)$/)
  if (!match || !LOCALES.has(match[1])) return null
  let slug: string
  try {
    slug = decodeURIComponent(match[2])
  } catch {
    return null
  }
  if (!SOURCE_SLUG_RE.test(slug)) return null
  const [, locale] = match
  try {
    const product = await getBySlug(slug)
    if (!product) {
      if (slug === MASTER_PACK_REDIRECT.source) {
        return {
          status: 'redirect',
          location: `${STOREFRONT_ORIGIN}/${locale}/prodotto/${MASTER_PACK_REDIRECT.destination}`,
          statusCode: 308,
        }
      }
      return null
    }
    if (product.unlisted !== true) {
      if (slug === MASTER_PACK_REDIRECT.source) {
        return {
          status: 'redirect',
          location: `${STOREFRONT_ORIGIN}/${locale}/prodotto/${MASTER_PACK_REDIRECT.destination}`,
          statusCode: 308,
        }
      }
      return null
    }
    const visited = new Set([slug])
    let target = product.supersededBy
    for (let depth = 0; depth < 64; depth += 1) {
      if (typeof target !== 'string' || !SLUG_RE.test(target) || visited.has(target)) return { status: 'not-found' }
      visited.add(target)
      const successor = await getBySlug(target)
      if (!successor) return { status: 'not-found' }
      if (successor.unlisted === true) {
        target = successor.supersededBy
        continue
      }
      // Static Next redirects are part of this graph too: resolve their edge
      // before returning a 301, otherwise the browser can enter a dead end or loop.
      const historicalDestination = historicalRedirectDestination(target)
      if (historicalDestination) {
        target = historicalDestination
        continue
      }
      return { status: 'redirect', location: `${STOREFRONT_ORIGIN}/${locale}/prodotto/${target}` }
    }
    return { status: 'not-found' }
  } catch {
    return { status: 'unavailable' }
  }
}
