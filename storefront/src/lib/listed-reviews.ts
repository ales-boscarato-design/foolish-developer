import type { Review } from './reviews-db'

export function listedReviewPageData<T extends Pick<Review, 'product_slug'>, P extends { slug: string; unlisted?: boolean }>(
  reviews: T[],
  products: P[],
): { reviews: T[]; products: P[] } {
  const listedProducts = products.filter(product => product.unlisted !== true)
  const listedSlugs = new Set(listedProducts.map(product => product.slug))
  return {
    reviews: reviews.filter(review => listedSlugs.has(review.product_slug)),
    products: listedProducts,
  }
}

export async function collectListedReviewPage<T extends Pick<Review, 'product_slug'>>(
  fetchBatch: (offset: number, limit: number) => Promise<T[]>,
  listedSlugs: ReadonlySet<string>,
  pageSize = 12,
  batchSize = 12,
): Promise<T[]> {
  const visible: T[] = []
  for (let offset = 0; visible.length < pageSize; offset += batchSize) {
    const batch = await fetchBatch(offset, batchSize)
    visible.push(...batch.filter((review) => listedSlugs.has(review.product_slug)))
    if (batch.length < batchSize) break
  }
  return visible.slice(0, pageSize)
}