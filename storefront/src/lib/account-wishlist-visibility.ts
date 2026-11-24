import type { WishlistItem } from './account-db'

export async function getVisibleWishlistItems(wishlist: WishlistItem[]): Promise<WishlistItem[]> {
  if (wishlist.length === 0) return []
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
  const slugs = [...new Set(wishlist.map((item) => item.product_slug).filter(Boolean))]
  if (slugs.length === 0) return []
  try {
    const query = new URLSearchParams({
      'where[slug][in]': slugs.join(','),
      'where[unlisted][not_equals]': 'true',
      limit: String(slugs.length),
      depth: '0',
    })
    const response = await fetch(`${cmsUrl}/api/products?${query}`, { cache: 'no-store' })
    if (!response.ok) return []
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || !Array.isArray((body as { docs?: unknown }).docs)) return []
    const docs = (body as { docs: unknown[] }).docs
    const visibleSlugs = new Set(docs.flatMap((doc) => {
      if (typeof doc !== 'object' || doc === null) return []
      const product = doc as { slug?: unknown; unlisted?: unknown }
      return typeof product.slug === 'string' && product.unlisted !== true ? [product.slug] : []
    }))
    return wishlist.filter((item) => visibleSlugs.has(item.product_slug))
  } catch {
    return []
  }
}
