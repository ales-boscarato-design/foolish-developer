/**
 * Test dei parametri della PaymentIntent B2B, con un client Stripe finto.
 * Nessuna rete, nessun SDK vero, nessuna chiave.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createOrderPaymentIntent, type StripeIntentDeps } from './stripe-intents'

interface Call {
  params: unknown
  opts: unknown
}

function fakeDeps(calls: Call[], clientSecret: string | null = 'pi_test_secret'): StripeIntentDeps {
  return {
    paymentIntents: {
      async create(params, opts) {
        calls.push({ params, opts })
        return { client_secret: clientSecret }
      },
    },
  }
}

test('la PaymentIntent porta importo, valuta, metadata e chiave di idempotenza', async () => {
  const calls: Call[] = []
  const result = await createOrderPaymentIntent({
    amountCents: 11992,
    orderId: 1001,
    orderNumber: 'B2B-2608-ABCD',
    resellerEmail: 'acquirente@example.test',
  }, fakeDeps(calls))

  assert.deepEqual(calls, [{
    params: {
      amount: 11992,
      currency: 'eur',
      metadata: {
        orderId: '1001',
        orderNumber: 'B2B-2608-ABCD',
        resellerEmail: 'acquirente@example.test',
      },
      automatic_payment_methods: { enabled: true },
    },
    opts: { idempotencyKey: 'B2B-2608-ABCD' },
  }])
  assert.deepEqual(result, { client_secret: 'pi_test_secret' })
})

test('orderId stringa viene serializzato nei metadata', async () => {
  const calls: Call[] = []
  await createOrderPaymentIntent({
    amountCents: 2264,
    orderId: 'ord_42',
    orderNumber: 'B2B-2608-EFGH',
    resellerEmail: 'x@example.test',
  }, fakeDeps(calls))
  const params = calls[0].params as { metadata: Record<string, string> }
  assert.equal(params.metadata.orderId, 'ord_42')
})

test('client_secret nullo passa invariato alla rotta', async () => {
  const result = await createOrderPaymentIntent({
    amountCents: 2264,
    orderId: 7,
    orderNumber: 'B2B-2608-IJKL',
    resellerEmail: 'x@example.test',
  }, fakeDeps([], null))
  assert.deepEqual(result, { client_secret: null })
})
