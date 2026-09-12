import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import {
  AffiliateAttributionError,
  attributePaidCheckout,
  calculateAffiliateCommissionCents,
  calculateAffiliateRateBps,
  createAffiliateAttributionCms,
  mapStripeChargeRefund,
  parseAffiliateCheckoutMetadata,
  parseAffiliateItemsJson,
  updateAffiliateConversionForStripeChargeRefund,
  updateConversionPaymentStatusByPaymentIntent,
  type AffiliateConversionCreatePayload,
  type AffiliateConversionCreateResult,
  type AffiliateAttributionCms,
} from './affiliate-attribution'

const promo = { id: 7, code: 'NESTOR', type: 'percent', active: true }
const affiliate = {
  id: 11,
  slug: 'nestor',
  status: 'active',
  promoCode: 7,
  commissionBaseRateBps: 1500,
  commissionStepRateBps: 300,
  commissionStepThresholdCents: 50_000,
  commissionMaxRateBps: 3800,
}

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_affiliate_test',
    object: 'checkout.session',
    livemode: true,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_affiliate_test',
    amount_total: 10_000,
    currency: 'eur',
    metadata: {
      order_ref: 'FOOLISH-AFFILIATE-TEST',
      promo_code: 'NESTOR',
      affiliate_id: '11',
      affiliate_slug: 'nestor',
      affiliate_promo_code: 'NESTOR',
      items_json: JSON.stringify([{ sku: 'TEST', qty: 1, price: 100, name: 'Test', variantLabel: 'A' }]),
    },
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

function canonicalConversion(payload: AffiliateConversionCreatePayload, overrides: Partial<AffiliateConversionCreateResult> = {}): AffiliateConversionCreateResult {
  return {
    status: 'created',
    stripeSessionId: payload.stripeSessionId,
    stripePaymentIntentId: payload.stripePaymentIntentId,
    orderNumber: payload.orderNumber,
    affiliate: payload.affiliate,
    promoCodeSnapshot: payload.promoCodeSnapshot,
    affiliateSlugSnapshot: payload.affiliateSlugSnapshot,
    eligibleAmountCents: payload.eligibleAmountCents,
    commissionRateBps: 1500,
    commissionAmountCents: 1500,
    currency: 'EUR',
    paymentStatus: 'paid',
    refundStatus: 'none',
    amountRefundedCents: 0,
    ...overrides,
  }
}

function fakeCms(overrides: Partial<AffiliateAttributionCms> = {}): AffiliateAttributionCms {
  return {
    findPromoCodesByExactCode: async () => [promo],
    findAffiliateByIdAndPromoCode: async () => [affiliate],
    findConversionByStripeSessionId: async () => null,
    createOrGetConversion: async (payload) => canonicalConversion(payload),
    patchOrderByNumber: async () => undefined,
    updateConversionPaymentStatusByPaymentIntent: async () => ({ status: 'stale' }),
    ...overrides,
  }
}

test('no promo code produces no conversion and makes no CMS calls', async () => {
  let calls = 0
  const result = await attributePaidCheckout({
    session: session({ metadata: { items_json: '[]' } }),
    orderNumber: 'FOOLISH-AFFILIATE-TEST',
    cms: fakeCms({ findPromoCodesByExactCode: async () => { calls += 1; return [] } }),
  })

  assert.deepEqual(result, { status: 'none' })
  assert.equal(calls, 0)
})

test('an ordinary promo without an affiliate marker is ignored without CMS affiliate lookup', async () => {
  let cmsCalls = 0
  const result = await attributePaidCheckout({
    session: session({
      metadata: {
        promo_code: 'NESTOR',
        items_json: JSON.stringify([{ sku: 'TEST', qty: 1, price: 100 }]),
      },
    }),
    orderNumber: 'FOOLISH-AFFILIATE-TEST',
    cms: fakeCms({
      findPromoCodesByExactCode: async () => { cmsCalls += 1; return [] },
      findAffiliateByIdAndPromoCode: async () => { cmsCalls += 1; return [] },
    }),
  })

  assert.deepEqual(result, { status: 'none' })
  assert.equal(cmsCalls, 0)
})

test('an affiliate marker must match the normalized promo code before CMS resolution', async () => {
  let cmsCalls = 0
  await assert.rejects(
    attributePaidCheckout({
      session: session({ metadata: { ...session().metadata, affiliate_promo_code: 'OTHER' } }),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({
        findPromoCodesByExactCode: async () => { cmsCalls += 1; return [promo] },
      }),
    }),
    (error: unknown) => error instanceof AffiliateAttributionError && error.code === 'metadata_invalid',
  )
  assert.equal(cmsCalls, 0)
})

test('malformed or non-cent-safe metadata fails closed before CMS resolution', () => {
  assert.equal(parseAffiliateItemsJson('{bad-json'), null)
  assert.equal(parseAffiliateItemsJson(JSON.stringify([{ sku: 'TEST', qty: 1, price: -1 }])), null)
  assert.equal(parseAffiliateItemsJson(JSON.stringify([{ sku: 'TEST', qty: 1, price: 10.001 }])), null)
  assert.equal(parseAffiliateCheckoutMetadata({
    promoCode: 'NESTOR',
    itemsJson: JSON.stringify([{ sku: 'TEST', qty: 1, priceCents: 100 }]),
    amountTotalCents: 99,
  }), null)
})

test('active ordinary percent promo resolves exactly one affiliate and writes ledger plus order snapshot', async () => {
  let conversionPayload: Record<string, unknown> | null = null
  let orderPatch: Record<string, unknown> | null = null
  const result = await attributePaidCheckout({
    session: session(),
    orderNumber: 'FOOLISH-AFFILIATE-TEST',
    now: new Date('2026-09-12T12:00:00.000Z'),
    cms: fakeCms({
      createOrGetConversion: async (payload) => {
        conversionPayload = payload as unknown as Record<string, unknown>
        return canonicalConversion(payload)
      },
      patchOrderByNumber: async (_orderNumber, patch) => { orderPatch = patch as unknown as Record<string, unknown> },
    }),
  })

  assert.deepEqual(result, {
    status: 'attributed',
    eligibleAmountCents: 10_000,
    commissionRateBps: 1500,
    commissionAmountCents: 1500,
  })
  const savedPayload = conversionPayload as unknown as Record<string, unknown> | undefined
  const savedPatch = orderPatch as unknown as Record<string, unknown> | undefined
  assert.ok(savedPayload)
  assert.ok(savedPatch)
  assert.equal(savedPayload.affiliate, 11)
  assert.equal(savedPayload.promoCodeSnapshot, 'NESTOR')
  assert.equal(savedPayload.currency, 'EUR')
  assert.equal(savedPayload.commissionRateBps, undefined)
  assert.equal(savedPayload.commissionAmountCents, undefined)
  assert.equal(savedPatch.affiliateCommissionCents, 1500)
})

test('attribution reads through the injected CMS interface', async () => {
  const calls: string[] = []
  await attributePaidCheckout({
    session: session(),
    orderNumber: 'FOOLISH-AFFILIATE-TEST',
    cms: fakeCms({
      findPromoCodesByExactCode: async () => { calls.push('promo'); return [promo] },
      findAffiliateByIdAndPromoCode: async () => { calls.push('affiliate'); return [affiliate] },
      findConversionByStripeSessionId: async () => { calls.push('conversion'); return null },
      createOrGetConversion: async (payload) => { calls.push('create'); return canonicalConversion(payload) },
      patchOrderByNumber: async () => { calls.push('order') },
    }),
  })

  assert.deepEqual(calls, ['conversion', 'promo', 'affiliate', 'create', 'order'])
})

test('an existing stripe session ledger row is not duplicated', async () => {
  let createCount = 0
  const result = await attributePaidCheckout({
    session: session(),
    orderNumber: 'FOOLISH-AFFILIATE-TEST',
    cms: fakeCms({
      findConversionByStripeSessionId: async () => ({
        id: 99,
        stripeSessionId: 'cs_affiliate_test',
        stripePaymentIntentId: 'pi_affiliate_test',
        orderNumber: 'FOOLISH-AFFILIATE-TEST',
        affiliate: 11,
        promoCodeSnapshot: 'NESTOR',
        affiliateSlugSnapshot: 'nestor',
        eligibleAmountCents: 10_000,
        commissionRateBps: 1500,
        commissionAmountCents: 1500,
        currency: 'EUR',
        paymentStatus: 'paid',
        refundStatus: 'none',
        amountRefundedCents: 0,
      }),
      createOrGetConversion: async () => { createCount += 1; throw new Error('must not create') },
    }),
  })

  assert.equal(result.status, 'attributed')
  assert.equal(createCount, 0)
})

test('an existing conflicting ledger row raises a typed inconsistency error', async () => {
  let orderPatchCount = 0
  await assert.rejects(
    attributePaidCheckout({
      session: session(),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({
        findConversionByStripeSessionId: async () => ({
          id: 99,
          stripeSessionId: 'cs_affiliate_test',
          orderNumber: 'FOOLISH-AFFILIATE-TEST',
          affiliate: 11,
          promoCodeSnapshot: 'NESTOR',
          affiliateSlugSnapshot: 'nestor',
        eligibleAmountCents: 10_000,
        commissionRateBps: 1500,
        commissionAmountCents: 1499,
        currency: 'EUR',
        paymentStatus: 'paid',
        refundStatus: 'none',
        }),
        patchOrderByNumber: async () => { orderPatchCount += 1 },
      }),
    }),
    (error: unknown) => error instanceof AffiliateAttributionError && error.code === 'ledger_inconsistent',
  )
  assert.equal(orderPatchCount, 0)
})

test('missing and ambiguous affiliate resolution fail closed', async () => {
  await assert.rejects(
    attributePaidCheckout({
      session: session(),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({ findAffiliateByIdAndPromoCode: async () => [] }),
    }),
    /affiliate_missing/,
  )
  await assert.rejects(
    attributePaidCheckout({
      session: session(),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({ findAffiliateByIdAndPromoCode: async () => [affiliate, { ...affiliate, id: 12 }] }),
    }),
    /affiliate_ambiguous/,
  )
})

test('rate threshold and cap use the affiliate config snapshot', () => {
  const config = {
    baseRateBps: 1500,
    stepRateBps: 300,
    thresholdCents: 50_000,
    maxRateBps: 1600,
  }
  assert.equal(calculateAffiliateRateBps(49_999, config), 1500)
  assert.equal(calculateAffiliateRateBps(50_000, config), 1600)
  assert.equal(calculateAffiliateCommissionCents(10_000, 1500), 1500)
  assert.equal(calculateAffiliateCommissionCents(10_001, 1500), 1500)
  assert.equal(calculateAffiliateRateBps(0, { ...config, thresholdCents: 0 }), null)
})

test('new conversions calculate cumulative multi-step rates and cap them', async () => {
  let rate = 0
  let commission = 0
  const multiStep = await attributePaidCheckout({
    session: session(),
    orderNumber: 'FOOLISH-AFFILIATE-MULTI-STEP',
    cms: fakeCms({
      createOrGetConversion: async (payload) => {
        rate = 2_100
        commission = 2_100
        return canonicalConversion(payload, { commissionRateBps: rate, commissionAmountCents: commission })
      },
    }),
  })
  assert.deepEqual(multiStep, {
    status: 'attributed',
    eligibleAmountCents: 10_000,
    commissionRateBps: 2_100,
    commissionAmountCents: 2_100,
  })
  assert.equal(rate, 2_100)
  assert.equal(commission, 2_100)

  const capped = await attributePaidCheckout({
    session: session({ id: 'cs_affiliate_cap_test' }),
    orderNumber: 'FOOLISH-AFFILIATE-CAP',
    cms: fakeCms({
      createOrGetConversion: async (payload) => canonicalConversion(payload, { commissionRateBps: 3_800, commissionAmountCents: 3_800 }),
    }),
  })
  assert.deepEqual(capped, {
    status: 'attributed',
    eligibleAmountCents: 10_000,
    commissionRateBps: 3_800,
    commissionAmountCents: 3_800,
  })
})

test('full-refunded conversion redelivery keeps snapshots and does not restore commission to the order', async () => {
  let orderPatchCount = 0
  const result = await attributePaidCheckout({
    session: session({ id: 'cs_affiliate_full_refund_test' }),
    orderNumber: 'FOOLISH-AFFILIATE-FULL-REFUND',
    cms: fakeCms({
      findConversionByStripeSessionId: async () => ({
        id: 100,
        stripeSessionId: 'cs_affiliate_full_refund_test',
        stripePaymentIntentId: 'pi_affiliate_test',
        orderNumber: 'FOOLISH-AFFILIATE-FULL-REFUND',
        affiliate: 11,
        promoCodeSnapshot: 'NESTOR',
        affiliateSlugSnapshot: 'nestor',
        eligibleAmountCents: 10_000,
        commissionRateBps: 1_500,
        commissionAmountCents: 0,
        currency: 'EUR',
        paymentStatus: 'refunded',
        refundStatus: 'full',
        amountRefundedCents: 10_000,
      }),
      patchOrderByNumber: async () => { orderPatchCount += 1 },
    }),
  })

  assert.deepEqual(result, {
    status: 'attributed',
    eligibleAmountCents: 10_000,
    commissionRateBps: 1_500,
    commissionAmountCents: 0,
  })
  assert.equal(orderPatchCount, 0)
})

test('paused or archived affiliate redelivery uses the stored snapshot before current resolution', async () => {
  for (const status of ['paused', 'archived'] as const) {
    let orderPatch: Record<string, unknown> | null = null
    const result = await attributePaidCheckout({
      session: session({ id: `cs_${status}_redelivery` }),
      orderNumber: 'FOOLISH-AFFILIATE-ORIGINAL',
      cms: fakeCms({
        findConversionByStripeSessionId: async () => ({
          stripeSessionId: `cs_${status}_redelivery`,
          stripePaymentIntentId: 'pi_affiliate_test',
          orderNumber: 'FOOLISH-AFFILIATE-ORIGINAL',
          affiliate: 11,
          promoCodeSnapshot: 'NESTOR',
          affiliateSlugSnapshot: 'nestor',
          eligibleAmountCents: 10_000,
          commissionRateBps: 1_500,
          commissionAmountCents: 1_500,
          currency: 'EUR',
          paymentStatus: 'paid',
          refundStatus: 'none',
          amountRefundedCents: 0,
        }),
        findPromoCodesByExactCode: async () => { throw new Error(`${status} promo must not resolve`) },
        findAffiliateByIdAndPromoCode: async () => { throw new Error(`${status} affiliate must not resolve`) },
        patchOrderByNumber: async (_orderNumber, patch) => { orderPatch = patch as unknown as Record<string, unknown> },
      }),
    })

    assert.deepEqual(result, {
      status: 'attributed',
      eligibleAmountCents: 10_000,
      commissionRateBps: 1_500,
      commissionAmountCents: 1_500,
    })
    assert.deepEqual(orderPatch, {
      affiliatePromoCode: 'NESTOR',
      affiliateSlug: 'nestor',
      affiliateEligibleAmountCents: 10_000,
      affiliateCommissionRateBps: 1_500,
      affiliateCommissionCents: 1_500,
    })
  }
})

test('a paused affiliate is still attributed when it was marked before the first webhook', async () => {
  let created = 0
  const result = await attributePaidCheckout({
    session: session({ id: 'cs_paused_before_first_webhook' }),
    orderNumber: 'FOOLISH-AFFILIATE-PAUSED',
    cms: fakeCms({
      findAffiliateByIdAndPromoCode: async () => [{ ...affiliate, status: 'paused' }],
      createOrGetConversion: async (payload) => {
        created += 1
        return canonicalConversion(payload)
      },
    }),
  })

  assert.equal(created, 1)
  assert.equal(result.status, 'attributed')
})

test('a PaymentIntent mismatch fails closed before patching the order', async () => {
  let patchCalls = 0
  await assert.rejects(
    attributePaidCheckout({
      session: session({ payment_intent: 'pi_different' }),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({
        findConversionByStripeSessionId: async () => ({
          stripeSessionId: 'cs_affiliate_test',
          stripePaymentIntentId: 'pi_affiliate_test',
          orderNumber: 'FOOLISH-AFFILIATE-TEST',
          affiliate: 11,
          promoCodeSnapshot: 'NESTOR',
          affiliateSlugSnapshot: 'nestor',
          eligibleAmountCents: 10_000,
          commissionRateBps: 1_500,
          commissionAmountCents: 1_500,
          currency: 'EUR',
          paymentStatus: 'paid',
          refundStatus: 'none',
          amountRefundedCents: 0,
        }),
        patchOrderByNumber: async () => { patchCalls += 1 },
      }),
    }),
    (error: unknown) => error instanceof AffiliateAttributionError && error.code === 'ledger_inconsistent',
  )
  assert.equal(patchCalls, 0)
})

test('malformed conversion states fail closed before order attribution', async () => {
  await assert.rejects(
    attributePaidCheckout({
      session: session(),
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      cms: fakeCms({
        findConversionByStripeSessionId: async () => ({
          stripeSessionId: 'cs_affiliate_test',
          stripePaymentIntentId: 'pi_affiliate_test',
          orderNumber: 'FOOLISH-AFFILIATE-TEST',
          affiliate: 11,
          promoCodeSnapshot: 'NESTOR',
          affiliateSlugSnapshot: 'nestor',
          eligibleAmountCents: 10_000,
          commissionRateBps: 1_500,
          commissionAmountCents: 1_500,
          currency: 'EUR',
          paymentStatus: 'paid',
          refundStatus: 'partial',
          amountRefundedCents: 2_500,
        }),
      }),
    }),
    (error: unknown) => error instanceof AffiliateAttributionError && error.code === 'ledger_inconsistent',
  )
})

test('non-negative and safe integer bounds reject malformed or overflowing lines', () => {
  assert.equal(parseAffiliateItemsJson(JSON.stringify([{ sku: 'TEST', qty: -1, priceCents: 100 }])), null)
  assert.equal(parseAffiliateItemsJson(JSON.stringify([{ sku: 'TEST', qty: 101, priceCents: 100 }])), null)
  assert.equal(parseAffiliateItemsJson(JSON.stringify([{ sku: 'TEST', qty: 1, priceCents: Number.MAX_SAFE_INTEGER }])), null)
  assert.equal(parseAffiliateItemsJson(JSON.stringify([
    { sku: 'TEST', qty: 100, priceCents: 999_999_99 },
    { sku: 'TEST-2', qty: 100, priceCents: 999_999_99 },
  ])), null)
  assert.deepEqual(parseAffiliateItemsJson(JSON.stringify([
    { sku: 'TEST', qty: 1, priceCents: 1_000 },
    { isGift: true, qty: 1, priceCents: 99_999 },
    { isShipping: true, qty: 1, priceCents: 765 },
  ])), {
    items: [
      { priceCents: 1_000, qty: 1, excluded: false },
      { priceCents: 99_999, qty: 1, excluded: true },
      { priceCents: 765, qty: 1, excluded: true },
    ],
    eligibleAmountCents: 1_000,
  })
  assert.equal(calculateAffiliateCommissionCents(-1, 1500), null)
  assert.equal(calculateAffiliateCommissionCents(10_000, -1), null)
})

test('full and partial charge refunds map safely to conversion payment patches', () => {
  assert.deepEqual(mapStripeChargeRefund({
    payment_intent: 'pi_refund_test',
    amount: 10_000,
    amount_refunded: 10_000,
    currency: 'eur',
    refunded: true,
    metadata: { affiliate_promo_code: 'NESTOR' },
  }), {
    paymentIntentId: 'pi_refund_test',
    hasAffiliateMarker: true,
    patch: {
      paymentStatus: 'refunded',
      refundStatus: 'full',
      amountRefundedCents: 10_000,
      commissionAmountCents: 0,
    },
  })

  assert.deepEqual(mapStripeChargeRefund({
    payment_intent: 'pi_refund_test',
    amount: 10_000,
    amount_refunded: 2_500,
    currency: 'eur',
    refunded: false,
    metadata: {},
  })?.patch, {
    paymentStatus: 'partially_refunded',
    refundStatus: 'partial',
    amountRefundedCents: 2_500,
  })
})

test('an unmarked charge refund is acknowledged by the refund helper', async () => {
  let cmsCalls = 0
  const result = await updateAffiliateConversionForStripeChargeRefund({
    charge: {
      payment_intent: 'pi_refund_test',
      amount: 10_000,
      amount_refunded: 2_500,
      currency: 'eur',
      refunded: false,
      metadata: {},
    },
    cms: fakeCms({
      updateConversionPaymentStatusByPaymentIntent: async () => {
        cmsCalls += 1
        return { status: 'updated' }
      },
    }),
  })

  assert.deepEqual(result, { status: 'non_affiliate' })
  assert.equal(cmsCalls, 0)
})

test('a marked refund-before-attribution returns missing for retry', async () => {
  const result = await updateAffiliateConversionForStripeChargeRefund({
    charge: {
      payment_intent: 'pi_refund_test',
      amount: 10_000,
      amount_refunded: 2_500,
      currency: 'eur',
      refunded: false,
      metadata: { affiliate_promo_code: 'NESTOR' },
    },
    cms: fakeCms({
      updateConversionPaymentStatusByPaymentIntent: async () => ({ status: 'missing' }),
    }),
  })

  assert.deepEqual(result, { status: 'missing' })
})

test('marked CMS update failure is propagated for retryable webhook handling', async () => {
  await assert.rejects(
    updateAffiliateConversionForStripeChargeRefund({
      charge: {
        payment_intent: 'pi_refund_test',
        amount: 10_000,
        amount_refunded: 2_500,
        currency: 'eur',
        refunded: false,
        metadata: { affiliate_promo_code: 'NESTOR' },
      },
      cms: fakeCms({
        updateConversionPaymentStatusByPaymentIntent: async () => {
          throw new Error('CMS unavailable')
        },
      }),
    }),
    /CMS unavailable/,
  )
})

test('charge refund handling preserves a missing result for a retryable webhook response', async () => {
  const result = await updateAffiliateConversionForStripeChargeRefund({
    charge: {
      payment_intent: 'pi_refund_test',
      amount: 10_000,
      amount_refunded: 2_500,
      currency: 'eur',
      refunded: false,
      metadata: { affiliate_promo_code: 'NESTOR' },
    },
    cms: fakeCms({
      updateConversionPaymentStatusByPaymentIntent: async () => ({ status: 'missing' }),
    }),
  })

  assert.deepEqual(result, { status: 'missing' })
})

test('the atomic refund transition contract preserves updated and stale results', async () => {
  for (const status of ['updated', 'stale'] as const) {
    const result = await updateConversionPaymentStatusByPaymentIntent(
      'pi_refund_test',
      {
        paymentStatus: 'refunded',
        refundStatus: 'full',
        amountRefundedCents: 10_000,
        commissionAmountCents: 0,
      },
      fakeCms({
        updateConversionPaymentStatusByPaymentIntent: async () => ({ status }),
      }),
    )
    assert.deepEqual(result, { status })
  }
})

test('the storefront refund client uses the protected atomic transition endpoint', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: unknown = null
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/affiliate-conversions\/apply-refund-transition$/)
    assert.equal(init?.method, 'POST')
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'stale' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const result = await createAffiliateAttributionCms().updateConversionPaymentStatusByPaymentIntent(
      'pi_refund_test',
      {
        paymentStatus: 'partially_refunded',
        refundStatus: 'partial',
        amountRefundedCents: 2_500,
      },
    )
    assert.deepEqual(result, { status: 'stale' })
    assert.deepEqual(requestBody, {
      stripePaymentIntentId: 'pi_refund_test',
      amountRefundedCents: 2_500,
      refundStatus: 'partial',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a paused duplicate create returns the canonical existing conversion without affiliate resolution', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  globalThis.fetch = async (input) => {
    requestUrl = String(input)
    return new Response(JSON.stringify({
      status: 'existing',
      stripeSessionId: 'cs_affiliate_test',
      stripePaymentIntentId: 'pi_affiliate_test',
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      affiliate: 11,
      promoCodeSnapshot: 'NESTOR',
      affiliateSlugSnapshot: 'nestor',
      eligibleAmountCents: 10_000,
      commissionRateBps: 1500,
      commissionAmountCents: 1500,
      currency: 'EUR',
      paymentStatus: 'paid',
      refundStatus: 'none',
      amountRefundedCents: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const result = await createAffiliateAttributionCms().createOrGetConversion({
      stripeSessionId: 'cs_affiliate_test',
      stripePaymentIntentId: 'pi_affiliate_test',
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      affiliate: 11,
      promoCodeSnapshot: 'NESTOR',
      affiliateSlugSnapshot: 'nestor',
      eligibleAmountCents: 10_000,
      currency: 'EUR',
      paidAt: '2026-09-12T12:00:00.000Z',
    })
    assert.equal(result.status, 'existing')
    assert.match(requestUrl, /\/api\/affiliate-conversions\/create-or-get-conversion$/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a snapshot mismatch from the idempotent create endpoint fails closed', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'mismatch' }), { status: 409 })

  try {
    await assert.rejects(
      createAffiliateAttributionCms().createOrGetConversion({
        stripeSessionId: 'cs_affiliate_test',
        stripePaymentIntentId: 'pi_affiliate_test',
        orderNumber: 'FOOLISH-AFFILIATE-TEST',
        affiliate: 11,
        promoCodeSnapshot: 'OTHER',
        affiliateSlugSnapshot: 'nestor',
        eligibleAmountCents: 10_000,
        currency: 'EUR',
        paidAt: '2026-09-12T12:00:00.000Z',
      }),
      /CMS conversion create failed 409/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refunded order attribution is a protected transactional no-op', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: unknown = null
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/affiliate-conversions\/apply-order-attribution$/)
    assert.equal(init?.method, 'POST')
    requestBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'refunded' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const result = await createAffiliateAttributionCms().patchOrderByNumber(
      'FOOLISH-AFFILIATE-TEST',
      {
        affiliatePromoCode: 'NESTOR',
        affiliateSlug: 'nestor',
        affiliateEligibleAmountCents: 10_000,
        affiliateCommissionRateBps: 1500,
        affiliateCommissionCents: 1500,
      },
      'cs_affiliate_test',
      'pi_affiliate_test',
    )
    assert.deepEqual(result, { status: 'refunded' })
    assert.deepEqual(requestBody, {
      stripeSessionId: 'cs_affiliate_test',
      stripePaymentIntentId: 'pi_affiliate_test',
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      affiliatePromoCode: 'NESTOR',
      affiliateSlug: 'nestor',
      affiliateEligibleAmountCents: 10_000,
      affiliateCommissionRateBps: 1500,
      affiliateCommissionCents: 1500,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('full refund transition zeroes ledger and order commission in the injected contract', async () => {
  let ledgerCommission = 1500
  let orderCommission = 1500
  const result = await updateAffiliateConversionForStripeChargeRefund({
    charge: {
      payment_intent: 'pi_refund_test',
      amount: 10_000,
      amount_refunded: 10_000,
      currency: 'eur',
      refunded: true,
      metadata: { affiliate_promo_code: 'NESTOR' },
    },
    cms: fakeCms({
      updateConversionPaymentStatusByPaymentIntent: async (_paymentIntentId, patch) => {
        if (patch.refundStatus === 'full') {
          ledgerCommission = 0
          orderCommission = 0
        }
        return { status: 'updated' }
      },
    }),
  })

  assert.deepEqual(result, { status: 'updated' })
  assert.equal(ledgerCommission, 0)
  assert.equal(orderCommission, 0)
})

test('the CMS create endpoint receives only immutable inputs and returns canonical commission values', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | null = null
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/affiliate-conversions\/create-or-get-conversion$/)
    assert.equal(init?.method, 'POST')
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      status: 'created',
      stripeSessionId: 'cs_affiliate_test',
      stripePaymentIntentId: 'pi_affiliate_test',
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      affiliate: 11,
      promoCodeSnapshot: 'NESTOR',
      affiliateSlugSnapshot: 'nestor',
      eligibleAmountCents: 10_000,
      commissionRateBps: 2_100,
      commissionAmountCents: 2_100,
      currency: 'EUR',
      paymentStatus: 'paid',
      refundStatus: 'none',
      amountRefundedCents: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const result = await createAffiliateAttributionCms().createOrGetConversion({
      stripeSessionId: 'cs_affiliate_test',
      stripePaymentIntentId: 'pi_affiliate_test',
      orderNumber: 'FOOLISH-AFFILIATE-TEST',
      affiliate: 11,
      promoCodeSnapshot: 'NESTOR',
      affiliateSlugSnapshot: 'nestor',
      eligibleAmountCents: 10_000,
      currency: 'EUR',
      paidAt: '2026-09-12T12:00:00.000Z',
    })
    assert.equal(result.commissionRateBps, 2_100)
    assert.equal(result.commissionAmountCents, 2_100)
    if (requestBody === null) throw new Error('missing request body')
    const body: Record<string, unknown> = requestBody
    assert.equal(body.affiliateId, 11)
    assert.equal(body.commissionRateBps, undefined)
    assert.equal(body.commissionAmountCents, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('concurrent attribution uses the serialized endpoint result as the canonical snapshot', async () => {
  let stored: AffiliateConversionCreateResult | null = null
  let createCalls = 0
  const cms = fakeCms({
    createOrGetConversion: async (payload) => {
      createCalls += 1
      await Promise.resolve()
      if (stored) return { ...stored, status: 'existing' }
      stored = canonicalConversion(payload, { commissionRateBps: 2_100, commissionAmountCents: 2_100 })
      return stored
    },
  })

  const [first, second] = await Promise.all([
    attributePaidCheckout({ session: session({ id: 'cs_concurrent_a' }), orderNumber: 'ORDER-A', cms }),
    attributePaidCheckout({ session: session({ id: 'cs_concurrent_a' }), orderNumber: 'ORDER-A', cms }),
  ])
  assert.equal(createCalls, 2)
  assert.deepEqual(first, { status: 'attributed', eligibleAmountCents: 10_000, commissionRateBps: 2_100, commissionAmountCents: 2_100 })
  assert.deepEqual(second, { status: 'attributed', eligibleAmountCents: 10_000, commissionRateBps: 2_100, commissionAmountCents: 2_100 })
})
