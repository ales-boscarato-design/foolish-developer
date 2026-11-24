import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { WishlistItem } from './account-db'

const accountHomePath = new URL('../app/(customer-app)/account/(protected)/page.tsx', import.meta.url)

const makeWishlistItem = (slug: string): WishlistItem => ({
  id: slug,
  product_slug: slug,
  product_name: `Saved ${slug}`,
  product_price: 10,
  saved_at: new Date('2026-01-01T00:00:00Z'),
  notified_at: null,
})

test('account home renders only currently listed wishlist products without mutating saved rows', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  const savedWishlist = [makeWishlistItem('withdrawn'), makeWishlistItem('listed')]
  globalThis.fetch = (async () => Response.json({ docs: [
    { slug: 'withdrawn', unlisted: true, active: true },
    { slug: 'listed', unlisted: false, active: false },
  ] })) as typeof fetch

  try {
    const { getVisibleWishlistItems } = await import('./account-wishlist-visibility')
    const wishlist = await getVisibleWishlistItems(savedWishlist)
    const page = readFileSync(accountHomePath, 'utf8').replace(/\s+/g, ' ')

    assert.deepEqual(wishlist.map((item) => item.product_name), ['Saved listed'])
    assert.deepEqual(savedWishlist.map((item) => item.product_slug), ['withdrawn', 'listed'])
    assert.match(page, /getVisibleWishlistItems\(savedWishlist\)/)
    assert.match(page, /\{wishlist\.length > 0 &&/)
    assert.match(page, /\{t\('saved'\)\} \(\{wishlist\.length\}\)/)
    assert.match(page, /\{wishlist\.slice\(0, 3\)\.map\(\(item\) =>/)
    assert.match(page, /\{item\.product_name\}/)
    assert.doesNotMatch(page, /getWishlist\(session\.email\),\s*locale/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('account home wishlist fails closed when the CMS is offline', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  globalThis.fetch = (async () => { throw new TypeError('CMS offline') }) as typeof fetch

  try {
    const { getVisibleWishlistItems } = await import('./account-wishlist-visibility')
    const wishlist = await getVisibleWishlistItems([makeWishlistItem('saved')])
    const page = readFileSync(accountHomePath, 'utf8')

    assert.deepEqual(wishlist, [])
    assert.match(page, /const wishlist = await getVisibleWishlistItems\(savedWishlist\)/)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})