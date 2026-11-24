import assert from 'node:assert/strict'
import test from 'node:test'
import { listedHomepageReviews } from './home-listed-reviews'

test('homepage review quotes omit reviews for unlisted or unresolved products', async () => {
  const reviews = [
    { rating: 5, body: 'The secret retired product is excellent', reviewer_name: 'A', product_slug: 'hidden' },
    { rating: 5, body: 'https://shop.invalid/it/prodotto/hidden', reviewer_name: 'B', product_slug: 'missing' },
    { rating: 4, body: 'Works perfectly', reviewer_name: 'C', product_slug: 'visible' },
    { rating: 5, body: 'Another great review', reviewer_name: 'D', product_slug: 'visible' },
  ]
  const resolved = await listedHomepageReviews(reviews, async (slug) => {
    if (slug === 'hidden') return { name: 'Secret retired product', unlisted: true }
    if (slug === 'visible') return { name: 'Visible product', unlisted: false }
    return null
  })
  assert.deepEqual(resolved.reviews.map(review => review.reviewer_name), ['C', 'D'])
  assert.deepEqual(resolved.productNames, { hidden: '', missing: '', visible: 'Visible product' })
})
