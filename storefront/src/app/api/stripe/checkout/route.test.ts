import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPaymentIntentMetadata } from './route'

const sessionMetadata = {
  order_ref: 'FOOLISH-CHECKOUT-TEST',
  customer_name: 'Checkout Test',
  customer_country: 'IT',
  customer_address: 'Via Test 1|Torino|10100',
  items_json: '[{"sku":"TEST-SKU","qty":1}]',
}

const promo = {
  code: 'SAVE15',
  type: 'percent' as const,
  discountAmountCents: 1500,
  discountPercent: 15,
  freeShipping: false,
  label: '15% off',
}

type PaymentIntentMetadata = {
  order_ref: string
  affiliate_id?: string
  affiliate_slug?: string
  affiliate_promo_code?: string
}

test('non-affiliate payment checkout copies order_ref without affiliate metadata', () => {
  const paymentIntentMetadata = buildPaymentIntentMetadata(
    sessionMetadata,
    null,
    promo,
  ) as PaymentIntentMetadata

  assert.equal(paymentIntentMetadata.order_ref, sessionMetadata.order_ref)
  assert.deepEqual(paymentIntentMetadata, { order_ref: sessionMetadata.order_ref })
  assert.equal(paymentIntentMetadata.affiliate_id, undefined)
  assert.equal(paymentIntentMetadata.affiliate_slug, undefined)
  assert.equal(paymentIntentMetadata.affiliate_promo_code, undefined)
})

test('affiliate payment checkout copies order_ref and preserves all affiliate metadata', () => {
  const affiliateMarker = {
    affiliateId: 42,
    affiliateSlug: 'save15-affiliate',
    affiliatePromoCode: 'SAVE15',
  }
  const paymentIntentMetadata = buildPaymentIntentMetadata(sessionMetadata, affiliateMarker, promo)

  assert.equal(paymentIntentMetadata.order_ref, sessionMetadata.order_ref)
  assert.deepEqual(paymentIntentMetadata, {
    order_ref: sessionMetadata.order_ref,
    affiliate_id: '42',
    affiliate_slug: 'save15-affiliate',
    affiliate_promo_code: 'SAVE15',
  })
})

test('affiliate metadata is not copied when the checkout has no applied promo', () => {
  const paymentIntentMetadata = buildPaymentIntentMetadata(
    sessionMetadata,
    {
      affiliateId: 42,
      affiliateSlug: 'save15-affiliate',
      affiliatePromoCode: 'SAVE15',
    },
    null,
  )

  assert.deepEqual(paymentIntentMetadata, { order_ref: sessionMetadata.order_ref })
})
