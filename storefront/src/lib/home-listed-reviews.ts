import type { Review } from './reviews-db'

type ProductLookup = (slug: string) => Promise<{ name: string; unlisted?: boolean } | null>

type HomepageReview = Pick<Review, 'rating' | 'body' | 'reviewer_name' | 'product_slug'>

export async function listedHomepageReviews(
  reviews: HomepageReview[],
  getProduct: ProductLookup,
): Promise<{ reviews: HomepageReview[]; productNames: Record<string, string> }> {
  const productNames: Record<string, string> = {}
  for (const review of reviews) {
    if (Object.hasOwn(productNames, review.product_slug)) continue
    try {
      const product = await getProduct(review.product_slug)
      productNames[review.product_slug] = product && product.unlisted !== true ? product.name : ''
    } catch {
      productNames[review.product_slug] = ''
    }
  }
  return {
    reviews: reviews.filter(review => Boolean(productNames[review.product_slug])),
    productNames,
  }
}
