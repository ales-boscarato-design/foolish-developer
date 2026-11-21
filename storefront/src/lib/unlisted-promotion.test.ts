import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { listedSubscriptionCards } from './unlisted-promotion'
import { offerProductIfListed } from './unlisted-offer'
import { subscriptionCheckoutError } from './subscription-checkout-error'

test('subscription hub only shows cards whose CMS product is listed', () => {
  const cards = [{ plan: 'tattoo' }, { plan: 'pmu' }] as const
  const configs = {
    tattoo: { product: { unlisted: true } },
    pmu: { product: { unlisted: false } },
  }
  assert.deepEqual(listedSubscriptionCards(cards, configs).map((card) => card.plan), ['pmu'])
  assert.deepEqual(listedSubscriptionCards(cards, { tattoo: undefined, pmu: undefined }), [])
  assert.deepEqual(listedSubscriptionCards(cards, { tattoo: null, pmu: null }), [])
})

test('customer offer does not expose an unlisted product', () => {
  assert.equal(offerProductIfListed({ slug: 'retired', unlisted: true }), null)
  assert.deepEqual(offerProductIfListed({ slug: 'current', unlisted: false }), { slug: 'current', unlisted: false })
})

test('subscription CTA exposes a clear typed unlisted error', () => {
  assert.equal(subscriptionCheckoutError({ error: 'product_unlisted' }, 'This subscription product is no longer available.'), 'This subscription product is no longer available.')
  assert.equal(subscriptionCheckoutError({ error: 'other' }, 'This subscription product is no longer available.'), null)
})

test('subscription unlisted error is translated across all supported locales', async () => {
  const texts = await Promise.all(['it', 'en', 'de', 'fr', 'es'].map(async (locale) => {
    const messages = JSON.parse(await readFile(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as {
      subscription?: { product?: { productUnlistedError?: string } }
    }
    return messages.subscription?.product?.productUnlistedError
  }))
  assert.equal(texts.length, 5)
  assert.ok(texts.every((text) => typeof text === 'string' && text.length > 20))
  assert.equal(new Set(texts).size, 5)
})
