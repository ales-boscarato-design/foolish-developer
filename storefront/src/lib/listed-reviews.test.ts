import assert from 'node:assert/strict'
import test from 'node:test'
import { collectListedReviewPage, listedReviewPageData } from './listed-reviews'

test('reviews page exposes only listed products, names, and their review rows', () => {
  const reviews = [
    { product_slug: 'listed', body: 'Retained' },
    { product_slug: 'hidden', body: 'Secret review' },
    { product_slug: 'missing', body: 'Orphan review' },
  ]
  const hiddenProduct = { slug: 'hidden', name: 'Secret product', unlisted: true }
  const inactiveProduct = { slug: 'inactive', name: 'Still reviewed', active: false, unlisted: false }
  const listedProduct = { slug: 'listed', name: 'Visible product', active: true, unlisted: false }
  const pageData = listedReviewPageData([...reviews, { product_slug: 'inactive', body: 'Still visible' }], [listedProduct, inactiveProduct, hiddenProduct])
  const selectorData = listedReviewPageData([], [listedProduct, hiddenProduct])
  assert.deepEqual(pageData.reviews, [reviews[0], { product_slug: 'inactive', body: 'Still visible' }])
  assert.deepEqual(pageData.products, [listedProduct, inactiveProduct])
  assert.deepEqual(selectorData.products, [listedProduct])
})

test('review pagination keeps filling the visible page after unlisted rows are removed', async () => {
  const rows = Array.from({ length: 17 }, (_, index) => ({ product_slug: index < 9 ? 'hidden' : 'listed', id: index }))
  const pages: number[] = []
  const page = await collectListedReviewPage(async (offset, limit) => {
    pages.push(offset)
    return rows.slice(offset, offset + limit)
  }, new Set(['listed']), 12, 5)
  assert.equal(page.length, 8)
  assert.deepEqual(pages, [0, 5, 10, 15])
})

test('review pagination caps the page at 12 visible rows and stops fetching', async () => {
  const pages: number[] = []
  const page = await collectListedReviewPage(async (offset, limit) => {
    pages.push(offset)
    return Array.from({ length: limit }, (_, index) => ({
      product_slug: 'listed',
      id: offset + index,
    }))
  }, new Set(['listed']))
  assert.equal(page.length, 12)
  assert.deepEqual(pages, [0])
})