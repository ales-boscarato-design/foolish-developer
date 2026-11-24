import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'

test('301 redirects use valid same-locale destinations and fail closed on loops or unsafe slugs', async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = 'http://cms.test'
  const products = new Map<string, Record<string, unknown>>([
    ['old-product', { slug: 'old-product', unlisted: true, supersededBy: 'new-product' }],
    ['new-product', { slug: 'new-product', unlisted: false }],
    ['chain-a', { slug: 'chain-a', unlisted: true, supersededBy: 'chain-b' }],
    ['chain-b', { slug: 'chain-b', unlisted: true, supersededBy: 'chain-c' }],
    ['chain-c', { slug: 'chain-c', unlisted: false }],
    ['master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', { slug: 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', unlisted: true, supersededBy: 'master-pack-20-fogli' }],
    ['master-pack-20-fogli', { slug: 'master-pack-20-fogli', unlisted: false }],
    ['cycle-source', { slug: 'cycle-source', unlisted: true, supersededBy: 'master-pack-20-fogli' }],
    ['historical-landing', { slug: 'historical-landing', unlisted: false }],
    ['legacy-chain', { slug: 'legacy-chain', unlisted: true, supersededBy: 'master-pack-20-fogli' }],
    ['one', { slug: 'one', unlisted: true, supersededBy: 'new-product' }],
    ['a'.repeat(64), { slug: 'a'.repeat(64), unlisted: true, supersededBy: 'new-product' }],
  ])
  let cmsUnavailable = false
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (cmsUnavailable) return new Response('unavailable', { status: 503 })
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const slug = url.searchParams.get('where[slug][equals]') ?? ''
    return Response.json({ docs: products.has(slug) ? [products.get(slug)] : [] })
  }) as typeof fetch
  try {
    const { unlistedProductRedirect } = await import('./unlisted-product-redirect')
    const { default: proxy } = await import('../proxy')
    const response = await proxy(new NextRequest('http://internal:8080/en/prodotto/old-product?utm_source=review&ref=partner', {
      headers: { host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid' },
    }))
    assert.equal(response.status, 301)
    assert.equal(response.headers.get('location'), 'https://thefoolishbutcher.com/en/prodotto/new-product?utm_source=review&ref=partner')

    products.set('old-product', { slug: 'old-product', unlisted: true })
    const missingSuccessor = await proxy(new NextRequest('http://shop.test/it/prodotto/old-product'))
    assert.equal(missingSuccessor.status, 404)

    products.set('self-loop', { slug: 'self-loop', unlisted: true, supersededBy: 'self-loop' })
    products.set('bad-target', { slug: 'bad-target', unlisted: true, supersededBy: '//evil.test' })
    products.set('missing-target', { slug: 'missing-target', unlisted: true, supersededBy: 'not-found' })
    products.set('cycle-a', { slug: 'cycle-a', unlisted: true, supersededBy: 'cycle-b' })
    products.set('cycle-b', { slug: 'cycle-b', unlisted: true, supersededBy: 'cycle-a' })
    for (const slug of ['self-loop', 'bad-target', 'missing-target', 'cycle-a']) {
      assert.deepEqual(await unlistedProductRedirect(`/it/prodotto/${slug}`), { status: 'not-found' }, slug)
    }
    assert.deepEqual(await unlistedProductRedirect('/it/prodotto/chain-a'), {
      status: 'redirect', location: 'https://thefoolishbutcher.com/it/prodotto/chain-c',
    })
    assert.deepEqual(await unlistedProductRedirect('/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl'), {
      status: 'not-found',
    }, 'a CMS successor that is sent back by a historical redirect must not create a loop')
    products.set('master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', {
      slug: 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', unlisted: true, supersededBy: 'cycle-source',
    })
    assert.deepEqual(await unlistedProductRedirect('/it/prodotto/cycle-source'), { status: 'not-found' },
      'the historical redirect edge must participate in cycle detection across the full chain')
    products.set('master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', {
      slug: 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', unlisted: false,
    })
    assert.deepEqual(await unlistedProductRedirect('/it/prodotto/legacy-chain'), {
      status: 'redirect', location: 'https://thefoolishbutcher.com/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl',
    }, 'a listed historical landing remains a valid terminal destination')
    assert.equal(await unlistedProductRedirect('/xx/prodotto/old-product'), null)
    assert.equal(await unlistedProductRedirect('/it/prodotto/old-product/extra'), null)
    products.set('listed-product', { slug: 'listed-product', unlisted: false, supersededBy: 'new-product' })
    assert.equal(await unlistedProductRedirect('/de/prodotto/listed-product'), null)
    assert.equal(await unlistedProductRedirect('/it/prodotto/absent-product'), null)
    products.set('old-product', { slug: 'old-product', unlisted: true, supersededBy: 'new-product' })
    assert.deepEqual(await unlistedProductRedirect('/fr/prodotto/old-product'), {
      status: 'redirect', location: 'https://thefoolishbutcher.com/fr/prodotto/new-product',
    })
    assert.deepEqual(await unlistedProductRedirect('/it/prodotto/one'), {
      status: 'redirect', location: 'https://thefoolishbutcher.com/it/prodotto/new-product',
    })
    assert.deepEqual(await unlistedProductRedirect(`/it/prodotto/${'a'.repeat(64)}`), {
      status: 'redirect', location: 'https://thefoolishbutcher.com/it/prodotto/new-product',
    })

    const encoded = await proxy(new NextRequest('http://shop.test/it/prodotto/%6Fne'))
    assert.equal(encoded.status, 301)
    assert.equal(encoded.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/new-product')
    const tracked = await proxy(new NextRequest('http://shop.test/it/prodotto/old-product?utm_source=newsletter&ref=partner-7&x=1'))
    assert.equal(tracked.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/new-product?utm_source=newsletter&ref=partner-7&x=1')
    const historicalChain = await proxy(new NextRequest('http://shop.test/it/prodotto/legacy-chain'))
    assert.equal(historicalChain.status, 301)
    assert.equal(historicalChain.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl')
    products.set('master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', {
      slug: 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl', unlisted: true, supersededBy: 'cycle-source',
    })
    const historicCycle = await proxy(new NextRequest('http://shop.test/it/prodotto/cycle-source'))
    assert.equal(historicCycle.status, 404)
    assert.equal(historicCycle.headers.get('location'), null)

    const { default: config } = await import('../../next.config')
    const redirects = await config.redirects?.()
    const master = redirects?.find((rule) => rule.source === '/it/prodotto/master-pack-20-fogli')
    assert.equal(master, undefined, 'unlisted-aware redirect must not be bypassed by a Next static redirect')
    products.set('master-pack-20-fogli', { slug: 'master-pack-20-fogli', unlisted: true })
    const hiddenMaster = await proxy(new NextRequest('http://shop.test/it/prodotto/master-pack-20-fogli'))
    assert.equal(hiddenMaster.status, 404)
    products.set('master-pack-20-fogli', { slug: 'master-pack-20-fogli', unlisted: false })
    const listedMaster = await proxy(new NextRequest('http://shop.test/it/prodotto/master-pack-20-fogli?utm_campaign=legacy&ref=old-link'))
    assert.equal(listedMaster.status, 308, 'listed historical redirect retains Next permanent-redirect status')
    assert.equal(listedMaster.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl?utm_campaign=legacy&ref=old-link')
    products.delete('master-pack-20-fogli')
    const absentMaster = await proxy(new NextRequest('http://shop.test/it/prodotto/master-pack-20-fogli'))
    assert.equal(absentMaster.status, 308, 'explicit CMS absence preserves the historic redirect')
    cmsUnavailable = true
    const cmsErrorMaster = await proxy(new NextRequest('http://shop.test/it/prodotto/master-pack-20-fogli'))
    assert.equal(cmsErrorMaster.status, 503, 'CMS failure is not interpreted as product absence')
    assert.equal(cmsErrorMaster.headers.get('location'), null)
    const listedProductDuringOutage = await proxy(new NextRequest('http://shop.test/it/prodotto/listed-product'))
    assert.equal(listedProductDuringOutage.status, 503, 'the proxy cannot establish current unlisted status for a known listed product during a CMS outage')
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalUrl
  }
})
