import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAffiliateCheckoutPromo,
  shouldMarkAffiliateCheckoutPromo,
} from './affiliate-checkout-marker'

const affiliatePromo = { id: 7, code: 'SAVE15', type: 'percent', active: true }
const activeAffiliate = { id: 11, slug: 'save15-affiliate', status: 'active', promoCode: 7 }

test('ordinary percent promos are not affiliate markers', () => {
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, []), false)
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, [{ status: 'active', promoCode: 8 }]), false)
})

test('exactly one active affiliate related to the promo is a marker', () => {
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, [activeAffiliate]), true)
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, [{ ...activeAffiliate, status: 'paused' }]), false)
})

test('the server helper uses the protected active relation query', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.PAYLOAD_API_SECRET
  const originalCmsUrl = process.env.PAYLOAD_PUBLIC_URL
  let requestUrl = ''
  let requestHeaders = new Headers()
  process.env.PAYLOAD_API_SECRET = 'test-secret'
  process.env.PAYLOAD_PUBLIC_URL = 'https://cms.test'
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    requestHeaders = new Headers(init?.headers)
    return new Response(JSON.stringify({ docs: [activeAffiliate] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    assert.deepEqual(await shouldMarkAffiliateCheckoutPromo(affiliatePromo), {
      affiliateId: 11,
      affiliateSlug: 'save15-affiliate',
      affiliatePromoCode: 'SAVE15',
    })
    assert.match(requestUrl, /\/api\/affiliates\?where\[promoCode\]\[equals\]=7/)
    assert.match(requestUrl, /where\[status\]\[equals\]=active/)
    assert.match(requestUrl, /limit=2/)
    assert.equal(requestHeaders.get('x-storefront-secret'), 'test-secret')
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.PAYLOAD_API_SECRET
    else process.env.PAYLOAD_API_SECRET = originalSecret
    if (originalCmsUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = originalCmsUrl
  }
})

test('missing or ambiguous affiliate data fails closed', () => {
  assert.equal(isAffiliateCheckoutPromo({ ...affiliatePromo, id: undefined }, [activeAffiliate]), false)
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, [activeAffiliate, activeAffiliate]), false)
  assert.equal(isAffiliateCheckoutPromo(affiliatePromo, undefined), false)
})

test('CMS errors fail closed without emitting a marker', async () => {
  const originalFetch = globalThis.fetch
  const originalSecret = process.env.PAYLOAD_API_SECRET
  process.env.PAYLOAD_API_SECRET = 'test-secret'
  globalThis.fetch = async () => {
    throw new Error('CMS unavailable')
  }

  try {
    assert.equal(await shouldMarkAffiliateCheckoutPromo(affiliatePromo), null)
  } finally {
    globalThis.fetch = originalFetch
    if (originalSecret === undefined) delete process.env.PAYLOAD_API_SECRET
    else process.env.PAYLOAD_API_SECRET = originalSecret
  }
})
