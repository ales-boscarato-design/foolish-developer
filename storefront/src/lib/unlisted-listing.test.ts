import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('home, category grids, limited grid, sitemap, and active compatibility filter out unlisted products', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://127.0.0.1:9'
  const calls: URL[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    calls.push(url)
    return Response.json({ docs: [
      { id: '1', slug: 'visible-product', active: true, unlisted: false },
      { id: '2', slug: 'inactive-but-reviewed', active: false, unlisted: false },
    ], page: 1, totalPages: 1, hasNextPage: false, nextPage: null })
  }) as typeof fetch
  try {
    const cms = await import('./cms')
    await cms.getProducts(undefined, 'it')
    assert.equal(calls.at(-1)?.searchParams.get('where[active][equals]'), 'true')
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')

    await cms.getProducts('tattoo', 'en')
    assert.equal(calls.at(-1)?.searchParams.get('where[section][equals]'), 'tattoo')
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')

    await cms.getLimitedProducts('de')
    assert.equal(calls.at(-1)?.searchParams.get('where[limitedStock][equals]'), 'true')
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')

    const { default: sitemap } = await import('../app/sitemap')
    const entries = await sitemap()
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')
    assert.ok(entries.some((entry) => entry.url.endsWith('/it/prodotto/visible-product')))
    await cms.getProducts('pmu')
    assert.equal(calls.at(-1)?.searchParams.get('where[active][equals]'), 'true')
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')

    const reviewProducts = await cms.getReviewVisibleProducts('it')
    assert.equal(calls.at(-1)?.searchParams.get('where[unlisted][not_equals]'), 'true')
    assert.equal(calls.at(-1)?.searchParams.has('where[active][equals]'), false)
    assert.equal(reviewProducts.find((product) => product.slug === 'inactive-but-reviewed')?.active, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})

test('product_unlisted checkout message is translated in all storefront locales', async () => {
  const messages = await Promise.all(['it', 'en', 'de', 'fr', 'es'].map(async (locale) => {
    const json = JSON.parse(await readFile(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as {
      checkout?: { errorProductUnlisted?: string }
    }
    return json.checkout?.errorProductUnlisted
  }))
  assert.equal(messages.length, 5)
  assert.ok(messages.every((message) => typeof message === 'string' && message.length > 10))
  assert.equal(new Set(messages).size, 5)
})
