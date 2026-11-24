import assert from 'node:assert/strict'
import test from 'node:test'
import type { WishlistItem } from './account-db'

const makeWishlistItem = (slug: string): WishlistItem => ({
  id: slug,
  product_slug: slug,
  product_name: `Saved ${slug}`,
  product_price: 10,
  saved_at: new Date('2026-01-01T00:00:00Z'),
  notified_at: null,
})

test('wishlist verifies current visibility; keeps inactive listed items and saved rows unchanged', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  const wishlist = [makeWishlistItem('retired'), makeWishlistItem('inactive-listed')]
  let requestedUrl: URL | undefined
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    return Response.json({ docs: [
      { slug: 'retired', unlisted: true, active: true },
      { slug: 'inactive-listed', unlisted: false, active: false },
    ] })
  }) as typeof fetch
  try {
    const { getVisibleWishlistItems } = await import('./account-wishlist-visibility')
    const visible = await getVisibleWishlistItems(wishlist)
    assert.deepEqual(visible.map((item) => item.product_slug), ['inactive-listed'])
    assert.equal(requestedUrl?.searchParams.get('where[slug][in]'), 'retired,inactive-listed')
    assert.equal(requestedUrl?.searchParams.get('where[unlisted][not_equals]'), 'true')
    assert.deepEqual(wishlist.map((item) => item.product_slug), ['retired', 'inactive-listed'])
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('wishlist fails closed when CMS visibility cannot be verified', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('offline', { status: 503 })) as typeof fetch
  try {
    const { getVisibleWishlistItems } = await import('./account-wishlist-visibility')
    assert.deepEqual(await getVisibleWishlistItems([makeWishlistItem('saved')]), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('review-visible products paginate Payload docs until the active reviewed product is included', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  const calls: URL[] = []
  const inactiveDocs = Array.from({ length: 100 }, (_, index) => ({
    id: String(index + 1), slug: `inactive-${index + 1}`, active: false, unlisted: false,
  }))
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    calls.push(url)
    const page = Number(url.searchParams.get('page'))
    if (page === 1) return Response.json({
      docs: inactiveDocs, page: 1, totalPages: 2, hasNextPage: true, nextPage: 2,
    })
    return Response.json({
      docs: [{ id: 'reviewed', slug: 'reviewed-active', active: true, unlisted: false }],
      page: 2, totalPages: 2, hasNextPage: false, nextPage: null,
    })
  }) as typeof fetch
  try {
    const { getReviewVisibleProducts } = await import('./cms')
    const { listedReviewPageData } = await import('./listed-reviews')
    const products = await getReviewVisibleProducts('it')
    const { reviews } = listedReviewPageData([{ product_slug: 'reviewed-active' }], products)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls.map((url) => url.searchParams.get('page')), ['1', '2'])
    assert.ok(calls.every((url) => url.searchParams.get('where[active][equals]') === null))
    assert.ok(calls.every((url) => url.searchParams.get('where[unlisted][not_equals]') === 'true'))
    assert.equal(products.length, 101)
    assert.equal(products[100]?.slug, 'reviewed-active')
    assert.deepEqual(reviews, [{ product_slug: 'reviewed-active' }])
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('review-visible products accepts Payload empty collection pagination metadata', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  let requestedUrl: URL | undefined
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    return Response.json({
      docs: [], page: 1, totalPages: 0, hasNextPage: false, nextPage: null,
    })
  }) as typeof fetch
  try {
    const { getReviewVisibleProducts } = await import('./cms')
    assert.deepEqual(await getReviewVisibleProducts('it'), [])
    assert.equal(requestedUrl?.searchParams.get('page'), '1')
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('review-visible pagination rejects malformed continuation instead of returning a partial collection', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  globalThis.fetch = (async () => Response.json({
    docs: [], page: 1, totalPages: 2, hasNextPage: true, nextPage: 3,
  })) as typeof fetch
  try {
    const { getReviewVisibleProducts } = await import('./cms')
    await assert.rejects(getReviewVisibleProducts('it'), /invalid pagination/i)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('review-visible pagination rejects empty-collection metadata requested on page 2', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  const calls: URL[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    calls.push(url)
    if (url.searchParams.get('page') === '1') return Response.json({
      docs: [{ id: 'first', slug: 'first', active: false, unlisted: false }],
      page: 1, totalPages: 2, hasNextPage: true, nextPage: 2,
    })
    return Response.json({ docs: [], page: 1, totalPages: 0, hasNextPage: false, nextPage: null })
  }) as typeof fetch
  try {
    const { getReviewVisibleProducts } = await import('./cms')
    await assert.rejects(getReviewVisibleProducts('it'), /invalid pagination/i)
    assert.deepEqual(calls.map((url) => url.searchParams.get('page')), ['1', '2'])
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})
