import assert from 'node:assert/strict'
import test from 'node:test'
import { availableSubscriptionCards } from './unlisted-promotion'
import { offerProductIfListed } from './unlisted-offer'

test('subscription hub shows both cards when a plan product is unlisted', () => {
  const cards = [{ plan: 'tattoo' }, { plan: 'pmu' }] as const
  const configs = {
    tattoo: { product: { unlisted: true } },
    pmu: { product: { unlisted: false } },
  }
  assert.deepEqual(availableSubscriptionCards(cards, configs).map((card) => card.plan), ['tattoo', 'pmu'])
  assert.deepEqual(availableSubscriptionCards(cards, { tattoo: undefined, pmu: undefined }), [])
  assert.deepEqual(availableSubscriptionCards(cards, { tattoo: null, pmu: null }), [])
})

test('customer offer does not expose an unlisted product', () => {
  assert.equal(offerProductIfListed({ slug: 'retired', unlisted: true }), null)
  assert.deepEqual(offerProductIfListed({ slug: 'current', unlisted: false }), { slug: 'current', unlisted: false })
})
