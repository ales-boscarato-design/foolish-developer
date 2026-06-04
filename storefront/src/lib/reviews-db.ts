import sql from './db'

export interface Review {
  id: string
  order_id: number
  product_id: number
  product_slug: string
  subscriber_id: string | null
  rating: number
  body: string | null
  photo_urls: string[]
  status: 'pending' | 'published' | 'removed'
  reviewer_name: string | null
  created_at: Date
  published_at: Date | null
}

export interface ReviewSummary {
  average: number
  count: number
}

export async function insertReview(params: {
  orderId: number
  productId: number
  productSlug: string
  subscriberId: string | null
  rating: number
  body: string | null
  photoUrls: string[]
  reviewerName: string | null
}): Promise<Review> {
  const rows = await sql<Review[]>`
    INSERT INTO marketing.reviews
      (order_id, product_id, product_slug, subscriber_id, rating, body, photo_urls, reviewer_name)
    VALUES
      (${params.orderId}, ${params.productId}, ${params.productSlug},
       ${params.subscriberId}, ${params.rating}, ${params.body ?? null},
       ${sql.array(params.photoUrls)}, ${params.reviewerName ?? null})
    RETURNING *
  `
  return rows[0]
}

export async function reviewExistsForOrder(orderId: number): Promise<boolean> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text FROM marketing.reviews WHERE order_id = ${orderId}
  `
  return parseInt(rows[0].count) > 0
}

export async function getPublishedReviewsByProduct(
  productSlug: string,
  limit = 5,
  offset = 0,
): Promise<Review[]> {
  return sql<Review[]>`
    SELECT * FROM marketing.reviews
    WHERE product_slug = ${productSlug} AND status = 'published'
    ORDER BY published_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
}

export async function getReviewSummary(productSlug: string): Promise<ReviewSummary> {
  const rows = await sql<{ average: string; count: string }[]>`
    SELECT
      COALESCE(AVG(rating), 0)::text AS average,
      COUNT(*)::text AS count
    FROM marketing.reviews
    WHERE product_slug = ${productSlug} AND status = 'published'
  `
  return {
    average: parseFloat(rows[0].average),
    count: parseInt(rows[0].count),
  }
}

export async function getHomepageReviews(limit = 10): Promise<Review[]> {
  return sql<Review[]>`
    SELECT * FROM marketing.reviews
    WHERE status = 'published'
      AND rating >= 4
      AND body IS NOT NULL
      AND body != ''
    ORDER BY published_at DESC
    LIMIT ${limit}
  `
}

export async function getAllPublishedReviews(params: {
  productSlug?: string
  rating?: number
  limit?: number
  offset?: number
}): Promise<Review[]> {
  const { productSlug, rating, limit = 12, offset = 0 } = params
  return sql<Review[]>`
    SELECT * FROM marketing.reviews
    WHERE status = 'published'
      ${productSlug ? sql`AND product_slug = ${productSlug}` : sql``}
      ${rating ? sql`AND rating = ${rating}` : sql``}
    ORDER BY published_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
}

export async function publishReview(id: string): Promise<void> {
  await sql`
    UPDATE marketing.reviews
    SET status = 'published', published_at = NOW()
    WHERE id = ${id}
  `
}

export async function removeReview(id: string): Promise<void> {
  await sql`
    UPDATE marketing.reviews SET status = 'removed' WHERE id = ${id}
  `
}

export async function getReviewById(id: string): Promise<Review | null> {
  const rows = await sql<Review[]>`
    SELECT * FROM marketing.reviews WHERE id = ${id} LIMIT 1
  `
  return rows[0] ?? null
}
